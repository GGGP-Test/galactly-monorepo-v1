// src/middleware/quota.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

export type Plan = "free" | "pro" | "internal";

export interface PlanLimits {
  /** Max successful /find-buyers calls per UTC day */
  dailyFindBuyers: number;
}

export interface QuotaConfig {
  /** Window size in whole days (keep 1 unless you really want multi-day windows) */
  windowDays: number;
  /** Limits per plan */
  plans: Record<Plan, PlanLimits>;
  /**
   * If the incoming x-api-key equals this value, we treat the caller as "internal"
   * (unlimited) so you can test freely from the Free Panel.
   */
  testingBypassKey?: string | null;
}

type Counter = { day: string; used: number; plan: Plan };

const findBuyersCounters = new Map<string, Counter>(); // key -> counter

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function nextResetAtMs(windowDays: number): number {
  const start = startOfUtcDay();
  start.setUTCDate(start.getUTCDate() + windowDays);
  return +start;
}
function bucketId(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function identityFrom(req: Request): string {
  // Prefer API key; otherwise fall back to IP (Express sets req.ip; behind proxies it uses X-Forwarded-For if trust proxy is on)
  return (req.get("x-api-key") || req.ip || "anon").trim().toLowerCase();
}
function planFrom(req: Request, cfg: QuotaConfig): Plan {
  const key = (req.get("x-api-key") || "").trim();
  if (cfg.testingBypassKey && key && key === cfg.testingBypassKey) return "internal";
  const headerPlan = (req.get("x-plan") || "").toLowerCase();
  if (headerPlan === "pro") return "pro";
  if (/^pro_/i.test(key)) return "pro";
  return "free";
}

const DEFAULTS: QuotaConfig = {
  windowDays: 1,
  plans: {
    free: { dailyFindBuyers: 3 },
    pro: { dailyFindBuyers: 1000 },
    internal: { dailyFindBuyers: 100000 },
  },
  testingBypassKey: "DEV-UNLIMITED",
};

export function quota(partial?: Partial<QuotaConfig>): RequestHandler {
  const cfg: QuotaConfig = {
    ...DEFAULTS,
    ...partial,
    plans: { ...DEFAULTS.plans, ...(partial?.plans || {}) },
  };

  return (req: Request, res: Response, next: NextFunction) => {
    // Only guard POST/GET /find-buyers routes (mounted by index.ts)
    // You’re using it only for those routes anyway.
    const id = identityFrom(req);
    const today = bucketId();
    const plan = planFrom(req, cfg);
    const limit = cfg.plans[plan]?.dailyFindBuyers ?? DEFAULTS.plans.free.dailyFindBuyers;

    let ctr = findBuyersCounters.get(id);
    if (!ctr || ctr.day !== today) {
      ctr = { day: today, used: 0, plan };
      findBuyersCounters.set(id, ctr);
    } else if (ctr.plan !== plan) {
      ctr.plan = plan; // keep latest
    }

    if (ctr.used >= limit && plan !== "internal") {
      return res.status(429).json({
        ok: false,
        error: "QUOTA",
        plan,
        used: ctr.used,
        limit,
        resetAtMs: nextResetAtMs(cfg.windowDays),
      });
    }

    // Let the handler run; increment after it succeeds
    // If you want to count every attempt (even failed), move this before next()
    const done = (err?: unknown) => {
      if (!err && plan !== "internal") ctr!.used += 1;
    };

    // Wrap res.json/end/send to catch successful completion
    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);
    res.json = ((body?: any) => { done(); return origJson(body); }) as any;
    res.send = ((body?: any) => { done(); return origSend(body as any); }) as any;

    next();
  };
}

export function snapshotQuota() {
  const items = Array.from(findBuyersCounters.entries()).map(([id, v]) => ({
    id,
    day: v.day,
    plan: v.plan,
    used: v.used,
  }));
  return {
    quota: {
      windowDays: DEFAULTS.windowDays,
      resetAtMs: nextResetAtMs(DEFAULTS.windowDays),
      counters: items,
    },
  };
}

export function resetQuota() {
  findBuyersCounters.clear();
}