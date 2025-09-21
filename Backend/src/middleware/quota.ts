// src/middleware/quota.ts
import type { Request, Response, NextFunction } from "express";

/**
 * Flexible config that accepts the keys you used in index.ts.
 * We'll normalize into a strict shape internally.
 */
export type QuotaConfig = Partial<{
  windowDays: number;

  // flat/synonym keys (supported for convenience)
  free: number;       // same as freeTotal
  pro: number;        // same as proTotal
  freeTotal: number;
  proTotal: number;
  freeHot: number;
  proHot: number;
}>;

type Plan = "free" | "pro";

type StrictPlanCfg = { total: number; hot: number };
type StrictCfg = {
  windowDays: number;
  plans: Record<Plan, StrictPlanCfg>;
};

type Counters = {
  total: number;
  hot: number;
  resetAt: number; // epoch ms
};

/**
 * In-memory counter store: key = `${plan}:${apiKey}:${bucket}`
 * bucket = UTC date (YYYY-MM-DD) when windowDays=1.
 */
const store = new Map<string, Counters>();

function startOfNextWindow(now: Date, windowDays: number): number {
  // reset to 00:00:00 UTC then add windowDays
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + windowDays);
  return d.getTime();
}

function bucketKey(now: Date, windowDays: number): string {
  // one bucket per day window; if >1 day, we still name by start date
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function detectPlan(req: Request): Plan {
  // Simple heuristic:
  // - Header x-plan=pro forces pro
  // - API keys prefixed with "pro_" are pro
  // - everything else = free
  const xp = String(req.header("x-plan") || "").toLowerCase();
  if (xp === "pro") return "pro";
  const key = String(req.header("x-api-key") || "");
  if (key.startsWith("pro_")) return "pro";
  return "free";
}

function apiKeyOf(req: Request): string {
  return String(req.header("x-api-key") || "anon");
}

function normalize(cfg?: QuotaConfig): StrictCfg {
  const windowDays = Math.max(1, Number(cfg?.windowDays ?? 1) | 0);

  // resolve synonyms with sensible defaults
  const freeTotal = Number(
    cfg?.freeTotal ?? cfg?.free ?? 3  // default 3/day for free
  );
  const freeHot = Number(
    cfg?.freeHot ?? 1                 // default 1 hot/day for free
  );

  const proTotal = Number(
    cfg?.proTotal ?? cfg?.pro ?? 1000 // generous default for pro
  );
  const proHot = Number(
    cfg?.proHot ?? 999                // effectively unlimited hot
  );

  return {
    windowDays,
    plans: {
      free: { total: Math.max(0, freeTotal | 0), hot: Math.max(0, freeHot | 0) },
      pro:  { total: Math.max(0, proTotal | 0),  hot: Math.max(0, proHot | 0)  },
    },
  };
}

function getCounters(key: string, now: Date, windowDays: number): Counters {
  const k = key;
  const c = store.get(k);
  if (c && now.getTime() < c.resetAt) return c;

  // expired or missing → reset
  const resetAt = startOfNextWindow(now, windowDays);
  const fresh: Counters = { total: 0, hot: 0, resetAt };
  store.set(k, fresh);
  return fresh;
}

function setQuotaHeaders(res: Response, plan: Plan, limit: StrictPlanCfg, counters: Counters) {
  res.setHeader("X-Quota-Plan", plan);
  res.setHeader("X-Quota-Limit", String(limit.total));
  res.setHeader("X-Quota-Remaining", String(Math.max(0, limit.total - counters.total)));
  res.setHeader("X-Quota-Reset", new Date(counters.resetAt).toISOString());
}

/**
 * Quota middleware factory.
 *
 * Enforces:
 *  - daily TOTAL request cap per API key & plan (hard-block with 429)
 * Tracks:
 *  - daily HOT usage by inspecting response payload (candidates with temp/temperature === 'hot')
 *
 * When blocked, returns:
 *  { ok:false, error:"QUOTA_EXCEEDED", plan, remaining, resetAt }
 */
export default function quota(userCfg?: QuotaConfig) {
  const cfg = normalize(userCfg);

  return function quotaMw(req: Request, res: Response, next: NextFunction) {
    const now = new Date();
    const plan: Plan = detectPlan(req);

    const apiKey = apiKeyOf(req);
    const bucket = bucketKey(now, cfg.windowDays);
    const storeKey = `${plan}:${apiKey}:${bucket}`;

    const limit = cfg.plans[plan];
    const counters = getCounters(storeKey, now, cfg.windowDays);

    // Hard block if total quota consumed
    if (counters.total >= limit.total) {
      setQuotaHeaders(res, plan, limit, counters);
      return res.status(429).json({
        ok: false,
        error: "QUOTA_EXCEEDED",
        plan,
        remaining: Math.max(0, limit.total - counters.total),
        resetAt: new Date(counters.resetAt).toISOString(),
      });
    }

    // We'll increment total only if the downstream handler returns 2xx.
    // Keep a flag to adjust after the response finishes.
    let incrementedTotal = false;
    let addedHot = 0;

    // Intercept res.json to count "hot" items from the outgoing body
    const originalJson = res.json.bind(res);
    (res as any).json = (body: any) => {
      // If request succeeded (we're inside json), increment total once.
      if (!incrementedTotal) {
        counters.total += 1;
        incrementedTotal = true;
      }

      try {
        const candidates: any[] = Array.isArray(body?.candidates) ? body.candidates : [];
        const hotCount = candidates.reduce((acc, c) => {
          const t = (c?.temperature || c?.temp || "").toString().toLowerCase();
          return acc + (t === "hot" ? 1 : 0);
        }, 0);

        if (hotCount > 0) {
          counters.hot += hotCount;
          addedHot = hotCount;
        }
      } catch {
        // ignore parse/count errors
      }

      setQuotaHeaders(res, plan, limit, counters);
      return originalJson(body);
    };

    // If downstream fails (>=400), roll back the optimistic total increment (if any).
    res.on("finish", () => {
      try {
        if (res.statusCode >= 400 && incrementedTotal) {
          counters.total = Math.max(0, counters.total - 1);
          // hot was only added inside json() path (2xx), so no hot rollback needed here.
        }
        // If we ever want to enforce hot caps strictly, we can compare counters.hot vs limit.hot here
        // and emit a warning metric, but we don't block post-facto.
      } catch {}
    });

    next();
  };
}