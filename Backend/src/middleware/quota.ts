// src/middleware/quota.ts
import { Request, Response, NextFunction, RequestHandler } from "express";

export type PlanName = "free" | "pro";

type Limits = {
  totalPerDay: number;   // max created candidates per day
  hotPerDay: number;     // max hot per day
  burstPerMin: number;   // max requests per minute
  cooldownSec: number;   // cooldown after burst trip
};

export interface QuotaConfig {
  windowDays: number;
  getPlan?: (req: Request) => PlanName;
  limits: Record<PlanName, Limits>;
  clock?: () => number;
}

const defaultConfig: QuotaConfig = {
  windowDays: 1,
  limits: {
    free: { totalPerDay: 3, hotPerDay: 1, burstPerMin: 4, cooldownSec: 60 },
    pro:  { totalPerDay: 200, hotPerDay: 9999, burstPerMin: 60, cooldownSec: 5 }
  },
  getPlan: (req) => {
    const key = (req.headers["x-api-key"] as string | undefined)?.trim();
    return key && key.startsWith("NF") ? "free" : "pro";
  },
  clock: () => Date.now(),
};

type Usage = {
  dayKey: string;
  total: number;
  hot: number;
  minuteStart: number;
  minuteHits: number;
  cooldownUntil?: number;
};

const store = new Map<string, Usage>();

function dayKey(now: number, days: number) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return String(Math.floor(d.getTime() / (86_400_000 * days)));
}

function keyFrom(req: Request, plan: PlanName) {
  const raw = (req.headers["x-api-key"] as string | undefined) || (req.ip ?? "anon");
  return `${plan}:${raw}`;
}

function ensureUsage(k: string, now: number, cfg: QuotaConfig) {
  const dk = dayKey(now, cfg.windowDays);
  const u = store.get(k);
  if (!u || u.dayKey !== dk) {
    const fresh: Usage = { dayKey: dk, total: 0, hot: 0, minuteStart: now, minuteHits: 0, cooldownUntil: undefined };
    store.set(k, fresh);
    return fresh;
  }
  return u;
}

// --- Admin helpers for testing ---
export function resetQuota(key?: string): number {
  if (!key) { const n = store.size; store.clear(); return n; }
  return store.delete(key) ? 1 : 0;
}
export function snapshotQuota(): Record<string, Usage> {
  const out: Record<string, Usage> = {};
  store.forEach((v, k) => { out[k] = { ...v }; });
  return out;
}

export default function quota(config?: Partial<QuotaConfig>): RequestHandler {
  const cfg: QuotaConfig = {
    ...defaultConfig,
    ...config,
    limits: { ...defaultConfig.limits, ...(config?.limits || {}) },
  };
  const nowFn = cfg.clock ?? (() => Date.now());

  const QUOTA_OFF = process.env.QUOTA_OFF === "1";
  const ALLOW_TEST = process.env.ALLOW_TEST === "1";

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST" || !/\/find-buyers$/.test(req.path)) return next();

    // global off switch
    if (QUOTA_OFF) return next();

    // dev bypass, only if explicitly allowed
    if (ALLOW_TEST && req.headers["x-test-mode"] === "1") return next();

    const now = nowFn();
    const plan = (cfg.getPlan ? cfg.getPlan(req) : defaultConfig.getPlan!(req)) as PlanName;
    const limits = cfg.limits[plan];
    const k = keyFrom(req, plan);
    const u = ensureUsage(k, now, cfg);

    if (u.cooldownUntil && now < u.cooldownUntil) {
      return res.status(429).json({
        ok: false, error: "COOLDOWN", retryAfterMs: u.cooldownUntil - now, plan,
        remaining: { total: Math.max(0, limits.totalPerDay - u.total), hot: Math.max(0, limits.hotPerDay - u.hot) },
      });
    }

    if (now - u.minuteStart >= 60_000) { u.minuteStart = now; u.minuteHits = 0; }
    if (u.minuteHits >= limits.burstPerMin) {
      u.cooldownUntil = now + limits.cooldownSec * 1000;
      return res.status(429).json({ ok: false, error: "RATE_LIMIT", retryAfterMs: u.cooldownUntil - now, plan });
    }

    const resetAt = new Date(new Date(now).setUTCHours(24, 0, 0, 0)).toISOString();
    if (u.total >= limits.totalPerDay) {
      return res.status(429).json({ ok: false, error: "QUOTA_TOTAL", plan, resetAt,
        remaining: { total: 0, hot: Math.max(0, limits.hotPerDay - u.hot) } });
    }
    if (u.hot >= limits.hotPerDay) {
      return res.status(429).json({ ok: false, error: "QUOTA_HOT", plan, resetAt,
        remaining: { total: Math.max(0, limits.totalPerDay - u.total), hot: 0 } });
    }

    u.minuteHits++;

    const originalJson = res.json.bind(res);
    res.json = ((body: any) => {
      try {
        if (body && body.ok !== false) {
          const created = typeof body?.created === "number"
            ? body.created
            : Array.isArray(body?.candidates) ? body.candidates.length : 1;
          const hot = typeof body?.hot === "number" ? body.hot : 0;
          u.total += Number.isFinite(created) ? created : 1;
          u.hot += Number.isFinite(hot) ? hot : 0;
        }
      } catch {}
      return originalJson(body);
    }) as any;

    next();
  };
}