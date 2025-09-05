// src/ops/cost-tracker.ts
/**
 * Per-tenant cost ledger with monthly caps.
 * Works in-memory by default; storage is pluggable.
 */
// src/ops/cost-tracker.ts
import { createAuditLogger, AuditLogger } from "../security/audit-log";

export type CostEventType = "LLM" | "CRAWL" | "ENRICHMENT" | "OUTREACH" | "STORAGE" | "OTHER";

export interface CostEvent {
  id: string;
  ts: number;
  tenantId: string;
  jobId?: string;
  type: CostEventType;
  provider?: string; // "openai" | "anthropic" | "xai" | "openrouter" | "gemini" | enrichment vendor
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  inputChars?: number;
  requests?: number;
  unitUSD?: number; // override unit price for "OTHER"
  costUSD: number;
  meta?: Record<string, unknown>;
}

export interface ModelPrice {
  inputPer1K: number; // USD per 1K input tokens
  outputPer1K: number; // USD per 1K output tokens
  request?: number; // per-request surcharge if any
}

export interface CostTrackerOptions {
  audit?: AuditLogger;
  onThreshold?: (ev: { tenantId: string; month: string; used: number; limit: number; percent: number }) => void;
}

export interface Budget {
  limitUSD: number; // monthly
  thresholds?: number[]; // [0.5, 0.8, 1.0]
}

type TenantMonth = `${string}-${string}`; // "YYYY-MM"

function ym(ts = Date.now()): TenantMonth {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` as TenantMonth;
}

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class CostTracker {
  private prices = new Map<string, ModelPrice>(); // key: `${provider}:${model}`
  private events: CostEvent[] = [];
  private budgets = new Map<string, Budget>(); // key: tenantId
  private spendByTenantMonth = new Map<string, number>(); // key: `${tenantId}:${YYYY-MM}`
  private firedThreshold = new Set<string>(); // key: `${tenantId}:${month}:${threshold}`

  constructor(private opts: CostTrackerOptions = {}) {
    this.seedDefaultPrices();
  }

  private key(p: string, m: string) {
    return `${p}:${m}`.toLowerCase();
  }

  private seedDefaultPrices() {
    // NOTE: These are placeholders. Update with current pricing at deploy time.
    // OpenAI (example)
    this.prices.set(this.key("openai", "gpt-4o-mini"), { inputPer1K: 0.15, outputPer1K: 0.60 });
    this.prices.set(this.key("openai", "gpt-4o"), { inputPer1K: 5.0, outputPer1K: 15.0 });
    // Anthropic (example)
    this.prices.set(this.key("anthropic", "claude-3-haiku"), { inputPer1K: 0.25, outputPer1K: 1.25 });
    this.prices.set(this.key("anthropic", "claude-3-opus"), { inputPer1K: 15.0, outputPer1K: 75.0 });
    // xAI Grok (example)
    this.prices.set(this.key("xai", "grok-2"), { inputPer1K: 2.0, outputPer1K: 10.0 });
    // Google Gemini (example)
    this.prices.set(this.key("gemini", "gemini-1.5-pro"), { inputPer1K: 3.5, outputPer1K: 10.5 });
    this.prices.set(this.key("gemini", "gemini-1.5-flash"), { inputPer1K: 0.35, outputPer1K: 1.05 });
    // OpenRouter pass-through (allow override per model)
  }

  setModelPrice(provider: string, model: string, price: ModelPrice) {
    this.prices.set(this.key(provider, model), price);
  }

  setBudget(tenantId: string, budget: Budget) {
    this.budgets.set(tenantId, budget);
  }

  getBudget(tenantId: string): Budget | undefined {
    return this.budgets.get(tenantId);
  }

  getPrices() {
    return Array.from(this.prices.entries()).map(([k, v]) => ({ key: k, ...v }));
  }

  private computeLLMCost(provider: string, model: string, tokensIn = 0, tokensOut = 0, requests = 1): number {
    const p = this.prices.get(this.key(provider, model));
    if (!p) return 0;
    const inCost = (tokensIn / 1000) * p.inputPer1K;
    const outCost = (tokensOut / 1000) * p.outputPer1K;
    const reqCost = p.request ? requests * p.request : 0;
    return +(inCost + outCost + reqCost).toFixed(6);
  }

  private addAndMaybeAlert(tenantId: string, ev: CostEvent) {
    this.events.push(ev);
    const month = ym(ev.ts);
    const k = `${tenantId}:${month}`;
    const used = (this.spendByTenantMonth.get(k) || 0) + ev.costUSD;
    this.spendByTenantMonth.set(k, used);

    const budget = this.budgets.get(tenantId);
    if (!budget || !budget.limitUSD || !budget.thresholds?.length) return;

    for (const t of budget.thresholds) {
      const thresholdKey = `${tenantId}:${month}:${t}`;
      const limitAt = budget.limitUSD * t;
      if (used >= limitAt && !this.firedThreshold.has(thresholdKey)) {
        this.firedThreshold.add(thresholdKey);
        this.opts.onThreshold?.({ tenantId, month, used, limit: budget.limitUSD, percent: t });
      }
    }
  }

  summary(tenantId: string) {
    const month = ym();
    const k = `${tenantId}:${month}`;
    const used = this.spendByTenantMonth.get(k) || 0;
    const budget = this.budgets.get(tenantId);
    return {
      month,
      usedUSD: +used.toFixed(4),
      limitUSD: budget?.limitUSD ?? null,
      remainingUSD: budget?.limitUSD ? +(budget.limitUSD - used).toFixed(4) : null,
    };
  }

  canSpend(tenantId: string, amountUSD: number) {
    const s = this.summary(tenantId);
    if (s.limitUSD == null) return true;
    return s.usedUSD + amountUSD <= s.limitUSD;
  }

  recordLLMUsage(args: {
    tenantId: string;
    jobId?: string;
    provider: string;
    model: string;
    tokensIn?: number;
    tokensOut?: number;
    requests?: number;
    meta?: Record<string, unknown>;
  }) {
    const ts = Date.now();
    const costUSD = this.computeLLMCost(args.provider, args.model, args.tokensIn, args.tokensOut, args.requests ?? 1);
    const ev: CostEvent = {
      id: id(),
      ts,
      tenantId: args.tenantId,
      jobId: args.jobId,
      type: "LLM",
      provider: args.provider,
      model: args.model,
      tokensIn: args.tokensIn,
      tokensOut: args.tokensOut,
      requests: args.requests ?? 1,
      costUSD,
      meta: args.meta,
    };
    this.addAndMaybeAlert(args.tenantId, ev);
    this.opts.audit?.emit({
      tenantId: args.tenantId,
      severity: "INFO",
      action: "MODEL_CALL",
      actor: { type: "system" },
      target: { type: "model", id: `${args.provider}:${args.model}` },
      meta: { tokensIn: args.tokensIn, tokensOut: args.tokensOut, costUSD },
    });
    return ev;
  }

  recordCrawlCost(args: { tenantId: string; jobId?: string; pages: number; costPerPageUSD: number; meta?: any }) {
    const ts = Date.now();
    const costUSD = +(args.pages * args.costPerPageUSD).toFixed(6);
    const ev: CostEvent = {
      id: id(),
      ts,
      tenantId: args.tenantId,
      jobId: args.jobId,
      type: "CRAWL",
      provider: "crawler",
      model: "http",
      requests: args.pages,
      costUSD,
      meta: args.meta,
    };
    this.addAndMaybeAlert(args.tenantId, ev);
    this.opts.audit?.emit({
      tenantId: args.tenantId,
      severity: "INFO",
      action: "CRAWL_END",
      actor: { type: "system" },
      target: { type: "job", id: args.jobId },
      meta: { pages: args.pages, costUSD },
    });
    return ev;
  }

  recordEnrichmentCost(args: {
    tenantId: string;
    jobId?: string;
    provider: string; // "apollo" | "clearbit" | "instantly" | ...
    requests: number;
    costPerReqUSD: number;
    meta?: any;
  }) {
    const ts = Date.now();
    const costUSD = +(args.requests * args.costPerReqUSD).toFixed(6);
    const ev: CostEvent = {
      id: id(),
      ts,
      tenantId: args.tenantId,
      jobId: args.jobId,
      type: "ENRICHMENT",
      provider: args.provider,
      model: "contacts",
      requests: args.requests,
      costUSD,
      meta: args.meta,
    };
    this.addAndMaybeAlert(args.tenantId, ev);
    this.opts.audit?.emit({
      tenantId: args.tenantId,
      severity: "INFO",
      action: "LEAD_ENRICHED",
      actor: { type: "system" },
      target: { type: "provider", id: args.provider },
      meta: { requests: args.requests, costUSD },
    });
    return ev;
  }

  recordOther(args: {
    tenantId: string;
    jobId?: string;
    type?: CostEventType;
    provider?: string;
    model?: string;
    unitUSD: number;
    quantity: number;
    meta?: any;
  }) {
    const ts = Date.now();
    const costUSD = +(args.unitUSD * args.quantity).toFixed(6);
    const ev: CostEvent = {
      id: id(),
      ts,
      tenantId: args.tenantId,
      jobId: args.jobId,
      type: args.type || "OTHER",
      provider: args.provider,
      model: args.model,
      requests: args.quantity,
      unitUSD: args.unitUSD,
      costUSD,
      meta: args.meta,
    };
    this.addAndMaybeAlert(args.tenantId, ev);
    return ev;
  }

  history(tenantId: string, filter?: Partial<Pick<CostEvent, "type" | "provider" | "model">>) {
    return this.events.filter(
      (e) =>
        e.tenantId === tenantId &&
        (!filter?.type || e.type === filter.type) &&
        (!filter?.provider || e.provider === filter.provider) &&
        (!filter?.model || e.model === filter.model)
    );
  }
}

export type CostMeta = {
  task: string;
  model: string;
  provider: string;
  requestId?: string;
};

export type SpendRecord = {
  ts: number;        // epoch ms
  usd: number;       // positive number
  meta: CostMeta;
};

export interface CostStorage {
  append(tenantId: string, rec: SpendRecord): Promise<void>;
  sumForMonth(tenantId: string, yyyymm: string): Promise<number>;
  listRecent?(tenantId: string, limit: number): Promise<SpendRecord[]>;
  setCap?(tenantId: string, usd: number): Promise<void>;
  getCap?(tenantId: string): Promise<number | undefined>;
}

function monthKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

/* ---------------- In-memory default storage ---------------- */

class MemoryStorage implements CostStorage {
  private sums = new Map<string, number>(); // `${tenant}:${yyyymm}` -> sum
  private recs = new Map<string, SpendRecord[]>(); // `${tenant}` -> records
  private caps = new Map<string, number>(); // `${tenant}` -> cap USD

  async append(tenantId: string, rec: SpendRecord): Promise<void> {
    const key = `${tenantId}:${monthKey(new Date(rec.ts))}`;
    this.sums.set(key, (this.sums.get(key) || 0) + rec.usd);
    const listKey = `${tenantId}`;
    const arr = this.recs.get(listKey) || [];
    arr.push(rec);
    if (arr.length > 5000) arr.shift(); // simple bound
    this.recs.set(listKey, arr);
  }

  async sumForMonth(tenantId: string, yyyymm: string): Promise<number> {
    return this.sums.get(`${tenantId}:${yyyymm}`) || 0;
  }

  async listRecent(tenantId: string, limit: number): Promise<SpendRecord[]> {
    const arr = this.recs.get(`${tenantId}`) || [];
    return arr.slice(-limit);
  }

  async setCap(tenantId: string, usd: number): Promise<void> {
    this.caps.set(tenantId, usd);
  }

  async getCap(tenantId: string): Promise<number | undefined> {
    return this.caps.get(tenantId);
  }
}

/* ---------------- Tracker facade ---------------- */

export interface CostTrackerInit {
  defaultMonthlyCapUSD?: number;
  storage?: CostStorage;
}

export class CostTracker {
  private storage: CostStorage;
  private defaultCap: number;

  constructor(init: CostTrackerInit = {}) {
    this.storage = init.storage || new MemoryStorage();
    this.defaultCap = init.defaultMonthlyCapUSD ?? 25; // sensible default
  }

  /** Add a cost entry and return the new spent total + remaining for the month. */
  async addCost(
    tenantId: string,
    usd: number,
    meta: CostMeta
  ): Promise<{ spent: number; cap: number; remaining: number }> {
    if (!Number.isFinite(usd) || usd < 0) throw new Error("usd must be >= 0");
    const rec: SpendRecord = { ts: Date.now(), usd, meta };
    await this.storage.append(tenantId, rec);
    const mk = monthKey();
    const spent = await this.storage.sumForMonth(tenantId, mk);
    const cap = (await this.storage.getCap?.(tenantId)) ?? this.defaultCap;
    return { spent, cap, remaining: Math.max(0, cap - spent) };
  }

  /** Get remaining monthly budget (may be negative if overage). */
  async getRemainingBudget(tenantId: string): Promise<number> {
    const mk = monthKey();
    const spent = await this.storage.sumForMonth(tenantId, mk);
    const cap = (await this.storage.getCap?.(tenantId)) ?? this.defaultCap;
    return cap - spent;
  }

  /** Hard guard for spending: call before making an API call. */
  async allow(tenantId: string, projectedUsd: number): Promise<boolean> {
    const remaining = await this.getRemainingBudget(tenantId);
    return remaining - projectedUsd >= -0.01; // tiny rounding slack
  }

  async setMonthlyCap(tenantId: string, capUSD: number): Promise<void> {
    if (capUSD <= 0) throw new Error("cap must be > 0");
    if (this.storage.setCap) return this.storage.setCap(tenantId, capUSD);
    // fallback: keep in-memory cap inside wrapper storage if provided
    const mem = this.storage as any;
    if (mem.caps instanceof Map) mem.caps.set(tenantId, capUSD);
  }

  async getMonthlyCap(tenantId: string): Promise<number> {
    return (await this.storage.getCap?.(tenantId)) ?? this.defaultCap;
  }

  async listRecent(tenantId: string, limit = 50) {
    return (await this.storage.listRecent?.(tenantId, limit)) ?? [];
  }
}

/** Singleton (optional) */
export const defaultCostTracker = new CostTracker();
