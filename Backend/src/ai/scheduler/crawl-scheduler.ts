// src/ai/scheduler/crawl-scheduler.ts
// Plan-aware, rate-limited scheduler that feeds discovery/crawl/enrichment tasks into a queue.
// Pure TS (no deps). Scheduler runs lightweight timers and guards against overload.
//
// Contracts: this module does not perform crawling itself. It only enqueues work.
// Integrates with your existing queue + workers (e.g., crawl-worker.ts, enrichment.ts).
// ------------------------------------------------------------------------------

export type Plan = "free" | "pro" | "scale";

export interface OrgProfile {
  orgId: string;
  plan: Plan;
  region?: string;
  // Default discovery seed for this org; per-run overrides allowed.
  leadQuery?: {
    productKeywords: string[];
    geos?: string[];
    intentHints?: string[];
    usageSignals?: ("ecom" | "ads" | "foodbev" | "beauty" | "coldchain")[];
    excludeBrands?: string[];
    maxTeamSize?: number;
    language?: string;
  };
  // Scheduling preferences
  cadence?: {
    // target number of fresh candidates we try to maintain per day (pre-enrichment)
    dailyDiscoveryTarget?: number;
    // target refreshes per day for known leads
    dailyRefreshTarget?: number;
    // earliest/ latest local hour to run heavy work (24h). If undefined, always allowed
    quietHours?: { start: number; end: number }; // heavy work avoided between start..end
  };
  // Hard caps to avoid cost surprises
  caps?: {
    maxDailyTasks?: number;
    maxConcurrentTasks?: number;
  };
  // Optional tags to drive rules/feature flags
  tags?: string[];
}

export interface TaskEnvelope<T = unknown> {
  id?: string;
  type: "discover" | "crawl" | "enrich" | "refresh";
  orgId: string;
  plan: Plan;
  priority: number; // 1 (highest) .. 10 (lowest)
  dedupeKey?: string; // queue should drop if same dedupeKey exists
  payload: T;
  createdAt: number;
  notBefore?: number; // epoch ms; queue should honor delay
}

export interface TaskQueue {
  push(task: TaskEnvelope): Promise<void>;
  size?(scope?: { orgId?: string }): Promise<number>;
}

export interface OrgStore {
  listActiveOrgs(): Promise<OrgProfile[]>;
  getOrg(orgId: string): Promise<OrgProfile | undefined>;
  // Called by scheduler when it decides cadence; optional persistence for observability
  setOrgMeta?(orgId: string, meta: Partial<{ lastDiscovery: number; lastRefresh: number }>): Promise<void>;
}

export interface FeatureFlags {
  isEnabled(flag: string, ctx: { orgId: string; plan: Plan; tags?: string[] }): boolean;
}

export interface RateLimiter {
  // returns ms to wait before next token available (0 means ok now)
  reserve(key: string, cost?: number): number;
}

export interface SchedulerOptions {
  queue: TaskQueue;
  orgs: OrgStore;
  flags?: FeatureFlags;
  limiter?: RateLimiter;
  // Global defaults
  defaults?: {
    dailyDiscoveryTarget?: number;
    dailyRefreshTarget?: number;
    maxConcurrentPerOrg?: number;
    maxDailyPerOrg?: number;
    // jitter (%) to spread load
    jitterPct?: number;
    // base interval between scheduling sweeps (ms)
    sweepIntervalMs?: number;
  };
  // Optional clock injection for tests
  now?: () => number;
  // Optional logger
  log?: (level: "debug" | "info" | "warn" | "error", msg: string, extra?: Record<string, any>) => void;
}

// ---------------- Utilities ----------------

const nowMs = () => Date.now();
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const jitter = (ms: number, pct = 0.2) => {
  const d = ms * pct;
  return ms + (Math.random() * 2 - 1) * d;
};

function isInQuietHours(localHour: number, quiet?: { start: number; end: number }): boolean {
  if (!quiet) return false;
  const { start, end } = quiet;
  if (start === end) return true; // always quiet (safety)
  return start < end
    ? localHour >= start && localHour < end
    : localHour >= start || localHour < end; // wraps midnight
}

function toLocalHour(ts: number, _region?: string): number {
  // In absence of per-org TZ, approximate using host TZ.
  return new Date(ts).getHours();
}

// ---------------- Token Bucket Limiter (simple, per-key) ----------------

export class TokenBucket implements RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number; rate: number; burst: number }>();
  constructor(private fillPerSec = 5, private burst = 10) {}

  reserve(key: string, cost = 1): number {
    const t = nowMs() / 1000;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, last: t, rate: this.fillPerSec, burst: this.burst };
      this.buckets.set(key, b);
    }
    // refill
    const elapsed = t - b.last;
    b.tokens = clamp(b.tokens + elapsed * b.rate, 0, b.burst);
    b.last = t;

    if (b.tokens >= cost) {
      b.tokens -= cost;
      return 0;
    }
    const need = cost - b.tokens;
    const waitSec = need / b.rate;
    // simulate consuming upon wait calculation (not actually deducting)
    return Math.ceil(waitSec * 1000);
  }
}

// ---------------- CrawlScheduler ----------------

export class CrawlScheduler {
  private opts: Required<SchedulerOptions["defaults"]>;
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly clock: () => number;
  private readonly log: SchedulerOptions["log"];

  // book-keeping per org to avoid over-enqueue in a single sweep
  private dailyCount = new Map<string, { day: string; count: number }>();

  constructor(private cfg: SchedulerOptions) {
    this.opts = {
      dailyDiscoveryTarget: cfg.defaults?.dailyDiscoveryTarget ?? 60,
      dailyRefreshTarget: cfg.defaults?.dailyRefreshTarget ?? 40,
      maxConcurrentPerOrg: cfg.defaults?.maxConcurrentPerOrg ?? 8,
      maxDailyPerOrg: cfg.defaults?.maxDailyPerOrg ?? 300,
      jitterPct: cfg.defaults?.jitterPct ?? 0.25,
      sweepIntervalMs: cfg.defaults?.sweepIntervalMs ?? 20_000,
    };
    this.clock = cfg.now ?? nowMs;
    this.log = cfg.log ?? (() => {});
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.sweep();
      } catch (err) {
        this.log("error", "scheduler sweep error", { err });
      } finally {
        if (this.running) {
          const interval = jitter(this.opts.sweepIntervalMs, this.opts.jitterPct);
          this.timer = setTimeout(tick, interval);
        }
      }
    };
    // start with a short initial delay to allow services to boot
    this.timer = setTimeout(tick, 2000);
    this.log("info", "crawl scheduler started");
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.log("info", "crawl scheduler stopped");
  }

  // On-demand: schedule discovery immediately for a specific org with an override query
  async scheduleImmediateDiscovery(orgId: string, override?: Partial<OrgProfile["leadQuery"]>, priority = 4) {
    const org = await this.cfg.orgs.getOrg(orgId);
    if (!org) throw new Error(`Org not found ${orgId}`);
    const payload = { query: { ...(org.leadQuery ?? {}), ...(override ?? {}) } };
    return this.enqueue({
      type: "discover",
      orgId: org.orgId,
      plan: org.plan,
      priority,
      payload,
      dedupeKey: `discover:${org.orgId}:${hashJson(payload.query)}`,
    });
  }

  // Force schedule a crawl for a domain (seed found out-of-band)
  async scheduleImmediateCrawl(orgId: string, domain: string, url?: string, priority = 3) {
    const org = await this.cfg.orgs.getOrg(orgId);
    if (!org) throw new Error(`Org not found ${orgId}`);
    const payload = { domain, url };
    return this.enqueue({
      type: "crawl",
      orgId,
      plan: org.plan,
      priority,
      payload,
      dedupeKey: `crawl:${orgId}:${domain}`,
    });
  }

  private async sweep() {
    const at = this.clock();
    const orgs = await this.cfg.orgs.listActiveOrgs();
    this.log("debug", "scheduler sweep orgs", { n: orgs.length });

    for (const org of orgs) {
      const localHour = toLocalHour(at, org.region);
      const quiet = org.cadence?.quietHours;
      const inQuiet = isInQuietHours(localHour, quiet);
      const plan = org.plan;

      // Respect quiet hours for heavy tasks (discovery/crawl). Allow refresh in quiet hours for PRO/Scale.
      const allowHeavy = !inQuiet || plan !== "free";

      // Back-pressure: simple per-org queue size check if supported
      let queued = 0;
      if (this.cfg.queue.size) {
        try { queued = await this.cfg.queue.size({ orgId: org.orgId }); } catch {}
      }

      // Concurrency cap per org
      const ccap = org.caps?.maxConcurrentTasks ?? this.opts.maxConcurrentPerOrg;
      if (queued > ccap * 2) {
        this.log("debug", "skip org due to backlog", { orgId: org.orgId, queued, ccap });
        continue;
      }

      // Daily quotas
      const dcap = org.caps?.maxDailyTasks ?? this.opts.maxDailyPerOrg;
      const dayKey = new Date(at).toISOString().slice(0, 10);
      const stats = this.dailyCount.get(org.orgId) ?? { day: dayKey, count: 0 };
      if (stats.day !== dayKey) { stats.day = dayKey; stats.count = 0; }
      if (stats.count >= dcap) {
        this.log("debug", "daily cap reached", { orgId: org.orgId, count: stats.count, dcap });
        this.dailyCount.set(org.orgId, stats);
        continue;
      }

      // Rate limit per plan (global)
      const rl = this.cfg.limiter ?? defaultLimiterForPlan(plan);
      const rlWait = rl.reserve(`plan:${plan}`, 1);
      if (rlWait > 0) {
        this.log("debug", "rate limited", { orgId: org.orgId, plan, waitMs: rlWait });
        continue;
      }

      // Decide tasks to enqueue
      const wantDiscovery = org.cadence?.dailyDiscoveryTarget ?? this.opts.dailyDiscoveryTarget;
      const wantRefresh = org.cadence?.dailyRefreshTarget ?? this.opts.dailyRefreshTarget;

      // Spread discovery over the day: compute desired so far
      const minutesInDay = 24 * 60;
      const nowMinutes = new Date(at).getHours() * 60 + new Date(at).getMinutes();
      const fraction = nowMinutes / minutesInDay;

      const targetDiscoverSoFar = Math.floor(wantDiscovery * fraction);
      const targetRefreshSoFar = Math.floor(wantRefresh * fraction);

      // Approximate: assume queued tasks contribute to "so far". If queue.size not available, be conservative.
      const discoverToAdd = clamp(targetDiscoverSoFar - Math.floor(queued / 2), 0, 20);
      const refreshToAdd = clamp(targetRefreshSoFar - Math.floor(queued / 2), 0, 10);

      // Heavy tasks only if allowed
      if (allowHeavy && discoverToAdd > 0) {
        await this.enqueueDiscoverBurst(org, discoverToAdd, at, stats);
      }

      // Refresh tasks (lighter) — can run in quiet hours for paying plans
      if ((plan === "pro" || plan === "scale") && refreshToAdd > 0) {
        await this.enqueueRefreshBurst(org, refreshToAdd, at, stats);
      }

      this.dailyCount.set(org.orgId, stats);
      if (this.cfg.orgs.setOrgMeta) {
        await this.cfg.orgs.setOrgMeta(org.orgId, { lastDiscovery: at });
      }
    }
  }

  private async enqueueDiscoverBurst(org: OrgProfile, n: number, at: number, stats: { day: string; count: number }) {
    const baseQuery = org.leadQuery ?? { productKeywords: ["packaging"] };
    for (let i = 0; i < n; i++) {
      // spread queries by adding rotation/jitter hints; actual composition done in lead-sources.ts
      const override = rotateQuery(baseQuery, i);
      const payload = { query: override };
      const delay = Math.floor(jitter(2000 * i, 0.5)); // spread within the sweep
      await this.enqueue({
        type: "discover",
        orgId: org.orgId,
        plan: org.plan,
        priority: org.plan === "free" ? 6 : 4,
        payload,
        notBefore: this.clock() + delay,
        dedupeKey: `discover:${org.orgId}:${hashJson(override)}`,
      });
      stats.count++;
      if (stats.count >= (org.caps?.maxDailyTasks ?? this.opts.maxDailyPerOrg)) break;
    }
  }

  private async enqueueRefreshBurst(org: OrgProfile, n: number, _at: number, stats: { day: string; count: number }) {
    // We don't know which leads to refresh here; let the worker decide (e.g., pick oldest by 'lastSeen').
    // Enqueue placeholder refresh intents for the worker to resolve.
    for (let i = 0; i < n; i++) {
      await this.enqueue({
        type: "refresh",
        orgId: org.orgId,
        plan: org.plan,
        priority: 7,
        payload: { pick: "oldest", batch: 10 },
        dedupeKey: `refresh:${org.orgId}:${Math.floor(this.clock() / 3_600_000)}`, // per-hour dedupe
      });
      stats.count++;
      if (stats.count >= (org.caps?.maxDailyTasks ?? this.opts.maxDailyPerOrg)) break;
    }
  }

  private async enqueue(task: Omit<TaskEnvelope, "createdAt">) {
    const t: TaskEnvelope = { ...task, createdAt: this.clock() };
    if (this.cfg.flags?.isEnabled("scheduler.debugLog", { orgId: t.orgId, plan: t.plan })) {
      this.log("debug", "enqueue", { type: t.type, orgId: t.orgId, priority: t.priority, dedupeKey: t.dedupeKey });
    }
    return this.cfg.queue.push(t);
  }
}

// ---------------- Defaults ----------------

function defaultLimiterForPlan(plan: Plan): RateLimiter {
  // per-plan nominal fill rates (tokens/sec) and bursts.
  if (plan === "free") return new TokenBucket(0.5, 3);   // ~1 task per 2s, burst 3
  if (plan === "pro") return new TokenBucket(2, 10);     // ~2/s
  return new TokenBucket(5, 20);                         // scale
}

function hashJson(o: unknown): string {
  const s = JSON.stringify(o);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(36);
}

function rotateQuery(base: NonNullable<OrgProfile["leadQuery"]>, i: number) {
  const clone = JSON.parse(JSON.stringify(base)) as NonNullable<OrgProfile["leadQuery"]>;
  const intents = clone.intentHints ?? ["wholesale", "distributor", "rfq", "supplier"];
  const geos = clone.geos ?? ["US"];
  // simple rotation
  clone.intentHints = [intents[i % intents.length]];
  clone.geos = [geos[i % geos.length]];
  return clone;
}

// ---------------- In-memory queue/store for local dev ----------------

export class InMemoryQueue implements TaskQueue {
  private buf: TaskEnvelope[] = [];
  async push(task: TaskEnvelope): Promise<void> {
    // dedupe: drop if a task with same dedupeKey exists
    if (task.dedupeKey && this.buf.some(t => t.dedupeKey === task.dedupeKey)) return;
    if (task.notBefore && task.notBefore > Date.now()) {
      // naive delayed insert
      setTimeout(() => { this.buf.push(task); }, task.notBefore - Date.now());
      return;
    }
    this.buf.push(task);
  }
  async size(scope?: { orgId?: string }): Promise<number> {
    if (!scope?.orgId) return this.buf.length;
    return this.buf.filter(t => t.orgId === scope.orgId).length;
  }
  // helper for tests
  drain(n = 50): TaskEnvelope[] {
    return this.buf.splice(0, n);
  }
}

export class InMemoryOrgs implements OrgStore {
  constructor(private list: OrgProfile[]) {}
  async listActiveOrgs(): Promise<OrgProfile[]> { return this.list; }
  async getOrg(orgId: string): Promise<OrgProfile | undefined> { return this.list.find(o => o.orgId === orgId); }
  async setOrgMeta(): Promise<void> { /* no-op */ }
}

// ---------------- Example bootstrap (optional; comment out in prod) ----------------
/*
if (require.main === module) {
  const queue = new InMemoryQueue();
  const orgs = new InMemoryOrgs([
    {
      orgId: "org_free",
      plan: "free",
      leadQuery: { productKeywords: ["stretch wrap", "pallet wrap"], geos: ["New Jersey"] },
      cadence: { dailyDiscoveryTarget: 30, quietHours: { start: 1, end: 6 } },
    },
    {
      orgId: "org_pro",
      plan: "pro",
      leadQuery: { productKeywords: ["poly mailers"], geos: ["California", "Nevada"], intentHints: ["wholesale", "rfq"] },
      cadence: { dailyDiscoveryTarget: 120, dailyRefreshTarget: 60 },
      caps: { maxDailyTasks: 500, maxConcurrentTasks: 12 },
    },
  ]);

  const sched = new CrawlScheduler({
    queue,
    orgs,
    limiter: new TokenBucket(4, 10),
    log: (lvl, msg, extra) => console.log(`[${lvl}]`, msg, extra ?? ""),
  });

  sched.start();

  // observe
  setInterval(() => {
    console.log("Queue size:", queue.drain(100).length, "drained tasks this tick");
  }, 5000);
}
*/
