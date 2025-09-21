import { Request, Response, NextFunction, RequestHandler } from "express";

/** Plans supported by the backend. */
export type Plan = "free" | "pro" | "internal";

export interface PlanLimit {
  /** Max allowed requests per calendar day (UTC-ish). */
  dailyTotal: number;
  /** Optional cooldown penalty (seconds) after a denial. */
  cooldownSec?: number;
}

export interface QuotaConfig {
  windowDays: number; // currently fixed at 1 day
  limits: {
    free: PlanLimit;
    pro: PlanLimit;
    internal: PlanLimit;
  };
  /** Force-disable all quota checks (fail-open) — useful for emergency testing. */
  disabled?: boolean;
  /** API keys that should be treated as "internal" (unlimited) */
  internalKeys: Set<string>;
}

const DEFAULTS: QuotaConfig = {
  windowDays: 1,
  limits: {
    free: { dailyTotal: 3, cooldownSec: 600 },      // 3/day, 10 min cool-down after deny
    pro: { dailyTotal: 250, cooldownSec: 30 },      // tune as needed
    internal: { dailyTotal: 1_000_000 },            // effectively unlimited
  },
  disabled: false,
  internalKeys: new Set<string>(),
};

let cfg: QuotaConfig = { ...DEFAULTS };

/** Programmatic config at boot. Call once from index.ts. */
export function configureQuota(partial?: {
  limits?: Partial<QuotaConfig["limits"]>;
  disabled?: boolean;
  internalKeys?: string[]; // easier to pass from env
}) {
  if (!partial) return;
  cfg = {
    ...cfg,
    disabled: partial.disabled ?? cfg.disabled,
    limits: { ...cfg.limits, ...(partial.limits || {}) } as QuotaConfig["limits"],
    internalKeys: new Set(partial.internalKeys ?? Array.from(cfg.internalKeys)),
  };
}

/** In-memory map of API key -> explicit plan assignment. */
const planByKey = new Map<string, Plan>();

/** In-memory usage counters (per key). */
type Usage = { day: number; total: number; blockedUntil?: number };
const usageByKey = new Map<string, Usage>();

function today(): number {
  // day number since epoch; good enough for calendar-day buckets
  return Math.floor(Date.now() / 86_400_000);
}

/** Set/override a plan for a given API key (e.g., promote a user to pro). */
export function setPlanForApiKey(key: string, plan: Plan) {
  if (!key) return;
  planByKey.set(key, plan);
}

/** Inspect assigned plan for a key. Falls back to free; honors internalKeys. */
export function getPlanForApiKey(key?: string): Plan {
  if (!key) return "free";
  if (cfg.internalKeys.has(key)) return "internal";
  return planByKey.get(key) ?? "free";
}

function checkAndConsumeNow(key: string, plan: Plan) {
  const now = Date.now();
  let u = usageByKey.get(key);
  if (!u) {
    u = { day: today(), total: 0, blockedUntil: undefined };
    usageByKey.set(key, u);
  }
  // New calendar day -> reset
  if (u.day !== today()) {
    u.day = today();
    u.total = 0;
    u.blockedUntil = undefined;
  }

  const limits = cfg.limits[plan];

  // Short-circuits
  if (cfg.disabled || plan === "internal") {
    return { ok: true, remaining: Number.MAX_SAFE_INTEGER };
  }

  if (u.blockedUntil && now < u.blockedUntil) {
    const retryAfterSec = Math.ceil((u.blockedUntil - now) / 1000);
    return { ok: false, retryAfterSec, remaining: 0 };
  }

  if (u.total >= limits.dailyTotal) {
    const cool = limits.cooldownSec ?? 60;
    u.blockedUntil = now + cool * 1000;
    usageByKey.set(key, u);
    return { ok: false, retryAfterSec: cool, remaining: 0 };
  }

  // Consume one unit
  u.total += 1;
  usageByKey.set(key, u);
  const remaining = Math.max(0, limits.dailyTotal - u.total);
  return { ok: true, remaining };
}

/** Express middleware — no arguments. Reads global config. */
export function quota(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = String(req.header("x-api-key") || "");
      const plan = getPlanForApiKey(key);
      const verdict = checkAndConsumeNow(key, plan);

      // Expose useful headers for the panel
      res.setHeader("X-Plan", plan);
      res.setHeader("X-Remaining", String(verdict.remaining ?? 0));

      if (!verdict.ok) {
        res.setHeader("Retry-After", String(verdict.retryAfterSec ?? 60));
        return res
          .status(429)
          .json({ ok: false, error: "QUOTA", plan, retryAfterSec: verdict.retryAfterSec ?? 60 });
      }
      return next();
    } catch {
      // Fail-open if something goes sideways; better than locking everyone out.
      return next();
    }
  };
}

/** Clear counters (all keys or a specific key). */
export function resetQuota(key?: string) {
  if (key) usageByKey.delete(key);
  else usageByKey.clear();
}

/** Snapshot current counters (for debug/admin). */
export function snapshotQuota() {
  const rows: Array<{ key: string; day: number; total: number; plan: Plan }> = [];
  for (const [key, u] of usageByKey) {
    rows.push({ key, day: u.day, total: u.total, plan: getPlanForApiKey(key) });
  }
  return rows;
}