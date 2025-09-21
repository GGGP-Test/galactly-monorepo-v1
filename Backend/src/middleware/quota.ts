// src/middleware/quota.ts
import { Request, Response, NextFunction, RequestHandler } from "express";

export type PlanLimits = { hot: number; warm: number; total?: number };
type Usage = { date: string; hot: number; warm: number; total: number };

type QuotaConfig = {
  plans: Record<string, PlanLimits>; // e.g. { free:{hot:1,warm:2}, pro:{hot:30,warm:120} }
};

const usageByKeyPlan = new Map<string, Usage>();

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function resetAtMidnightUTC(): string {
  const now = new Date();
  const reset = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0
  ));
  return reset.toISOString();
}
function getUsage(key: string, plan: string): Usage {
  const k = `${plan}|${key}`;
  const d = todayUTC();
  const prev = usageByKeyPlan.get(k);
  if (!prev || prev.date !== d) {
    const fresh: Usage = { date: d, hot: 0, warm: 0, total: 0 };
    usageByKeyPlan.set(k, fresh);
    return fresh;
  }
  return prev;
}
function isHot(c: any): boolean {
  const t = String(c?.temperature || "").toLowerCase();
  if (t === "hot") return true;
  const s = typeof c?.score === "number" ? c.score : undefined;
  return typeof s === "number" && s >= 0.65;
}

/**
 * Plan-aware daily quota middleware.
 * - Reads plan from `x-plan` (defaults to "free").
 * - Requires `x-api-key` to count per user.
 * - Intercepts res.json on find-buyers responses, clamps candidates, updates usage.
 * - On empty allowance, sends 402 QUOTA_EXCEEDED with quota details.
 */
export default function quota(config: QuotaConfig): RequestHandler {
  const plans = config.plans;

  return (req: Request, res: Response, next: NextFunction) => {
    // Determine plan (defaults to free)
    const planHeader = String(req.header("x-plan") || "free").toLowerCase();
    const plan = plans[planHeader] ? planHeader : "free";
    const limits = plans[plan];
    const limitTotal = typeof limits.total === "number" ? limits.total : (limits.hot + limits.warm);

    const apiKey = String(req.header("x-api-key") || "").trim();
    if (!apiKey) {
      res.status(401).json({ ok: false, error: "API_KEY_REQUIRED" });
      return;
    }

    // Expose plan on response headers for debugging
    res.setHeader("x-plan", plan);

    const originalJson = res.json.bind(res) as (b: any) => Response;

    (res as any).json = (body: any) => {
      // only clamp the expected shape
      if (!body || typeof body !== "object" || !Array.isArray(body.candidates)) {
        return originalJson(body);
      }

      const usage = getUsage(apiKey, plan);
      const leftHot = Math.max(0, limits.hot  - usage.hot);
      const leftWarm = Math.max(0, limits.warm - usage.warm);
      const leftTotal = Math.max(0, limitTotal - usage.total);

      // No allowance left?
      if (leftTotal <= 0 || (leftHot <= 0 && leftWarm <= 0)) {
        const resetAt = resetAtMidnightUTC();
        return originalJson({
          ok: false,
          error: "QUOTA_EXCEEDED",
          quota: {
            plan,
            limit: { hot: limits.hot, warm: limits.warm, total: limitTotal },
            used:  { hot: usage.hot,  warm: usage.warm,  total: usage.total },
            resetAt
          }
        });
      }

      // Select up to allowance, preserving order
      const chosen: any[] = [];
      let pickHot = 0, pickWarm = 0;
      for (const cand of body.candidates) {
        const hot = isHot(cand);
        if (hot && pickHot < leftHot) {
          chosen.push(cand); pickHot++;
        } else if (!hot && pickWarm < leftWarm) {
          chosen.push(cand); pickWarm++;
        }
        if (chosen.length >= leftTotal) break;
        if (pickHot >= leftHot && pickWarm >= leftWarm) break;
      }

      if (chosen.length === 0) {
        const resetAt = resetAtMidnightUTC();
        return originalJson({
          ok: false,
          error: "QUOTA_EXCEEDED",
          quota: {
            plan,
            limit: { hot: limits.hot, warm: limits.warm, total: limitTotal },
            used:  { hot: usage.hot,  warm: usage.warm,  total: usage.total },
            resetAt
          }
        });
      }

      // Update usage
      usage.hot += pickHot;
      usage.warm += pickWarm;
      usage.total += pickHot + pickWarm;

      // Attach quota to success body
      const resetAt = resetAtMidnightUTC();
      body.candidates = chosen;
      body.quota = {
        plan,
        limit: { hot: limits.hot, warm: limits.warm, total: limitTotal },
        used:  { hot: usage.hot,  warm: usage.warm,  total: usage.total },
        remaining: {
          hot: Math.max(0, limits.hot  - usage.hot),
          warm:Math.max(0, limits.warm - usage.warm),
          total:Math.max(0, limitTotal - usage.total)
        },
        resetAt
      };

      return originalJson(body);
    };

    next();
  };
}