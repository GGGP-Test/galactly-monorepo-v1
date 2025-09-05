// src/ops/cost-tracker.ts
/**
 * Per-tenant cost ledger with monthly caps.
 * Works in-memory by default; storage is pluggable.
 */

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
