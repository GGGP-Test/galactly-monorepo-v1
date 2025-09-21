// src/middleware/quota.ts
import { Request, Response, NextFunction } from "express";

type QuotaOpts = {
  freeHot: number;   // e.g. 1
  freeWarm: number;  // e.g. 2
  // future: add pro limits, etc.
};

type Usage = {
  date: string;  // YYYY-MM-DD (UTC)
  hot: number;
  warm: number;
  total: number;
};

const usageByKey = new Map<string, Usage>();

function todayKeyUTC(): string {
  // YYYY-MM-DD from UTC time
  return new Date().toISOString().slice(0, 10);
}

function nextMidnightUTCISO(): string {
  const now = new Date();
  const reset = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return reset.toISOString();
}

function getUsage(key: string): Usage {
  const d = todayKeyUTC();
  const prev = usageByKey.get(key);
  if (!prev || prev.date !== d) {
    const fresh: Usage = { date: d, hot: 0, warm: 0, total: 0 };
    usageByKey.set(key, fresh);
    return fresh;
  }
  return prev;
}

function isHotCandidate(c: any): boolean {
  const temp = String((c && c.temperature) || "").toLowerCase();
  if (temp === "hot") return true;
  const score = typeof c?.score === "number" ? c.score : undefined;
  return typeof score === "number" && score >= 0.65;
}

/**
 * Quota middleware:
 * - Defaults everyone to "free" (unlimited "pro" can be added later).
 * - Requires x-api-key for free tier (so we can count per user).
 * - Intercepts res.json for /find-buyers responses, clamps candidates to remaining allowance
 *   (max 1 hot + 2 warm / day now), and updates usage.
 * - If no remaining allowance, returns 402 with FREE_QUOTA_EXCEEDED.
 */
export default function quota(opts: QuotaOpts) {
  const freeDailyTotal = opts.freeHot + opts.freeWarm;

  return function quotaMiddleware(req: Request, res: Response, next: NextFunction) {
    // Determine plan (future-ready). For now default to FREE.
    const planHeader = String(req.header("x-plan") || "").toLowerCase();
    const isPro = planHeader === "pro";

    if (isPro) {
      // Pro plan: pass-through, no quota.
      return next();
    }

    const apiKey = String(req.header("x-api-key") || "").trim();
    if (!apiKey) {
      res.status(401).json({ ok: false, error: "API_KEY_REQUIRED" });
      return;
    }

    // Wrap res.json so we can clamp the returned candidates.
    const originalJson = res.json.bind(res) as (b: any) => Response;

    (res as any).json = (body: any) => {
      // Only act on the expected success shape with candidates list
      if (!body || typeof body !== "object" || !Array.isArray(body.candidates)) {
        return originalJson(body);
      }

      const usage = getUsage(apiKey);
      const remainingHot = Math.max(0, opts.freeHot  - usage.hot);
      const remainingWarm = Math.max(0, opts.freeWarm - usage.warm);
      const remainingTotal = Math.max(0, freeDailyTotal - usage.total);

      if (remainingTotal <= 0 || (remainingHot <= 0 && remainingWarm <= 0)) {
        const resetAt = nextMidnightUTCISO();
        return originalJson({
          ok: false,
          error: "FREE_QUOTA_EXCEEDED",
          quota: {
            plan: "free",
            limit:  { hot: opts.freeHot, warm: opts.freeWarm, total: freeDailyTotal },
            used:   { hot: usage.hot,   warm: usage.warm,   total: usage.total },
            resetAt
          }
        });
      }

      // Preserve original order, selecting up to remainingHot/remainingWarm.
      const chosen: any[] = [];
      let pickedHot = 0;
      let pickedWarm = 0;

      for (const cand of body.candidates) {
        const hot = isHotCandidate(cand);
        if (hot && pickedHot < remainingHot) {
          chosen.push(cand);
          pickedHot += 1;
        } else if (!hot && pickedWarm < remainingWarm) {
          chosen.push(cand);
          pickedWarm += 1;
        }
        if (chosen.length >= remainingTotal) break;
        if (pickedHot >= remainingHot && pickedWarm >= remainingWarm) break;
      }

      // If after clamping we have nothing left to return, report quota exceeded.
      if (chosen.length === 0) {
        const resetAt = nextMidnightUTCISO();
        return originalJson({
          ok: false,
          error: "FREE_QUOTA_EXCEEDED",
          quota: {
            plan: "free",
            limit:  { hot: opts.freeHot, warm: opts.freeWarm, total: freeDailyTotal },
            used:   { hot: usage.hot,   warm: usage.warm,   total: usage.total },
            resetAt
          }
        });
      }

      // Update usage
      usage.hot   += pickedHot;
      usage.warm  += pickedWarm;
      usage.total += pickedHot + pickedWarm;
      usageByKey.set(apiKey, usage);

      // Attach quota info to the success body and send clamped candidates
      const resetAt = nextMidnightUTCISO();
      body.candidates = chosen;
      body.quota = {
        plan: "free",
        limit:  { hot: opts.freeHot, warm: opts.freeWarm, total: freeDailyTotal },
        used:   { hot: usage.hot,   warm: usage.warm,   total: usage.total },
        remaining: {
          hot: Math.max(0, opts.freeHot  - usage.hot),
          warm:Math.max(0, opts.freeWarm - usage.warm),
          total:Math.max(0, freeDailyTotal - usage.total)
        },
        resetAt
      };

      return originalJson(body);
    };

    next();
  };
}