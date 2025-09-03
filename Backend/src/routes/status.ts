// backend/src/routes/status.ts
// Returns plan + quota + devUnlimited so the Free Panel can show searches/reveals left.
// Wire up in index.ts with:  registerStatusRoutes(app, ctx)

import type { Express, Request, Response } from 'express';

/** Context shared across routes (kept minimal) */
export type Ctx = {
  users?: Map<string, { plan?: 'free' | 'pro' | 'custom'; email?: string; domain?: string }>;
  quotaStore?: Map<string, { date: string; findsUsed: number; revealsUsed: number }>;
  limits?: {
    freeFindsPerDay: number;
    freeRevealsPerDay: number;
    proFindsPerDay: number;
    proRevealsPerDay: number;
  };
  /** If true, UI should display ∞ for quota (used for dev/testing). */
  devUnlimited?: boolean;
};

/** Helpers */
function todayUTC(): string {
  // YYYY-MM-DD in UTC
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function ensureMaps(ctx: Ctx) {
  if (!ctx.users) ctx.users = new Map();
  if (!ctx.quotaStore) ctx.quotaStore = new Map();
  if (!ctx.limits) {
    ctx.limits = {
      freeFindsPerDay: numFromEnv('FREE_FINDS_PER_DAY', 2),
      freeRevealsPerDay: numFromEnv('FREE_REVEALS_PER_DAY', 2),
      proFindsPerDay: numFromEnv('PRO_FINDS_PER_DAY', 100),
      proRevealsPerDay: numFromEnv('PRO_REVEALS_PER_DAY', 100),
    };
  }
  if (ctx.devUnlimited === undefined) {
    ctx.devUnlimited = (process.env.DEV_UNLIMITED || '').toLowerCase() === 'true';
  }
}

function numFromEnv(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getPlan(ctx: Ctx, userId: string): 'free' | 'pro' | 'custom' {
  const p = ctx.users?.get(userId)?.plan;
  return (p as any) || 'free';
}

function ensureQuotaRow(ctx: Ctx, userId: string, plan: 'free' | 'pro' | 'custom') {
  const row = ctx.quotaStore!.get(userId);
  const today = todayUTC();
  if (!row) {
    const fresh = { date: today, findsUsed: 0, revealsUsed: 0 };
    ctx.quotaStore!.set(userId, fresh);
    return fresh;
  }
  if (row.date !== today) {
    row.date = today;
    row.findsUsed = 0;
    row.revealsUsed = 0;
  }
  return row;
}

function calcLeft(ctx: Ctx, plan: 'free' | 'pro' | 'custom', findsUsed: number, revealsUsed: number) {
  const L = ctx.limits!;
  const pf = plan === 'pro' || plan === 'custom';
  const findsCap = pf ? L.proFindsPerDay : L.freeFindsPerDay;
  const revealsCap = pf ? L.proRevealsPerDay : L.freeRevealsPerDay;
  const findsLeft = Math.max(0, findsCap - findsUsed);
  const revealsLeft = Math.max(0, revealsCap - revealsUsed);
  return { findsLeft, revealsLeft, findsCap, revealsCap };
}

/** Optional: attach simple quota helpers so other routes (e.g., find-now) can consume them. */
export function attachQuotaHelpers(ctx: Ctx) {
  ensureMaps(ctx);
  (ctx as any).quota = {
    status: async (userId: string) => {
      const plan = getPlan(ctx, userId);
      const row = ensureQuotaRow(ctx, userId, plan);
      const left = calcLeft(ctx, plan, row.findsUsed, row.revealsUsed);
      return {
        date: row.date,
        findsUsed: row.findsUsed,
        revealsUsed: row.revealsUsed,
        findsLeft: ctx.devUnlimited ? left.findsCap : left.findsLeft,
        revealsLeft: ctx.devUnlimited ? left.revealsCap : left.revealsLeft,
      };
    },
    take: async (userId: string, kind: 'find' | 'reveal') => {
      ensureMaps(ctx);
      if (ctx.devUnlimited) return; // no-op in dev-unlimited
      const plan = getPlan(ctx, userId);
      const row = ensureQuotaRow(ctx, userId, plan);
      if (kind === 'find') row.findsUsed += 1;
      else row.revealsUsed += 1;
    },
    reset: async (userId: string) => {
      const today = todayUTC();
      ctx.quotaStore!.set(userId, { date: today, findsUsed: 0, revealsUsed: 0 });
    },
  };
}

/** Registers the /status endpoint and a dev-only /quota/reset endpoint. */
export default function registerStatusRoutes(app: Express, ctx: Ctx) {
  ensureMaps(ctx);

  // GET /api/v1/status
  app.get('/api/v1/status', async (req: Request, res: Response) => {
    try {
      const userId = (req.header('x-galactly-user') || '').toString() || 'anon';
      const plan = getPlan(ctx, userId);
      const row = ensureQuotaRow(ctx, userId, plan);
      const left = calcLeft(ctx, plan, row.findsUsed, row.revealsUsed);
      const devUnlimited = ctx.devUnlimited === true;

      res.json({
        ok: true,
        uid: userId,
        plan,
        quota: {
          date: row.date,
          findsUsed: row.findsUsed,
          revealsUsed: row.revealsUsed,
          findsLeft: devUnlimited ? left.findsCap : left.findsLeft,
          revealsLeft: devUnlimited ? left.revealsCap : left.revealsLeft,
        },
        devUnlimited,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'status_failed' });
    }
  });

  // POST /api/v1/quota/reset  (dev-only helper for testing)
  app.post('/api/v1/quota/reset', async (req: Request, res: Response) => {
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const userId = (req.header('x-galactly-user') || '').toString() || 'anon';
    const today = todayUTC();
    ctx.quotaStore!.set(userId, { date: today, findsUsed: 0, revealsUsed: 0 });
    res.json({ ok: true, reset: true });
  });
}
