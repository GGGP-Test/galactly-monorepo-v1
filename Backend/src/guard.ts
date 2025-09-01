// Backend/src/guard.ts
// Fair-play guard for free/paid usage, press-and-hold timing, and simple abuse control.
// No schema changes required. Uses event_log + claim_window + app_user.user_prefs.
//
// How to wire (quick):
//   import { guardMiddleware, logGuardEvent, guardStatus } from './guard';
//   app.get('/api/v1/status', async (req,res)=> res.json(await guardStatus(req)));
//   app.post('/api/v1/reveal', guardMiddleware('reveal'), async (req,res)=> { ... await logGuardEvent(req,'reveal'); res.json({ok:true}) });
//   app.post('/api/v1/claim',  guardMiddleware('claim'),  async (req,res)=> { ... await logGuardEvent(req,'claim');  res.json({ok:true}) });
//   app.post('/api/v1/preview-tick', guardMiddleware('preview'), async (req,res)=> { await logGuardEvent(req,'preview'); res.json({ok:true}); });
//
// Env knobs (all optional; sane defaults below):
//   GUARD_REVEALS_PER_DAY_FREE=2        Free daily reveals
//   GUARD_REVEALS_PER_DAY_PRO=30        Pro daily reveals
//   GUARD_PREVIEW_PER_MIN_FREE=12       Free previews/min
//   GUARD_PREVIEW_PER_MIN_PRO=60        Pro previews/min
//   GUARD_MIN_HOLD_MS_FREE=1200         Min press-and-hold (ms) at low usage
//   GUARD_MAX_HOLD_MS_FREE=3500         Max press-and-hold (ms) when user is noisy
//   GUARD_MIN_HOLD_MS_PRO=800
//   GUARD_MAX_HOLD_MS_PRO=1800
//   GUARD_CLAIMS_CONCURRENT_FREE=1
//   GUARD_CLAIMS_CONCURRENT_PRO=3
//   GUARD_SCORE_BASE=100
//   GUARD_SCORE_COST_REVEAL=12
//   GUARD_SCORE_COST_PREVIEW_BURST=3     (cost for each preview beyond soft limit in last 60s)
//   GUARD_SCORE_REWARD_CONFIRM=6         (+ when user confirms ad proof)
//   GUARD_SCORE_REWARD_OWN=10            (+ when user completes 'own')
//   GUARD_BLOCK_BELOW_SCORE=25           (hard block if score drops under this)
//   GUARD_IP_BURST_PER_MIN=90            (global IP preview throttling)
//
// Notes:
// - "plan" detection: app_user.user_prefs.plan ∈ {'free','pro','enterprise'}. Defaults to 'free'.
// - All counts are per user; some soft limits also consider req.ip.
// - Press-and-hold is returned in status for the client UI to respect.

import type { Request, Response, NextFunction } from 'express';
import { q } from './db';

type Plan = 'free'|'pro'|'enterprise';

export type GuardQuotas = {
  plan: Plan;
  score: number;                  // 0..100
  pressHoldMs: number;
  cooldownSec: number;

  // day/minute quotas
  revealsToday: number;
  revealsMax: number;
  previewsLastMin: number;
  previewsPerMinMax: number;

  // concurrency
  concurrentClaims: number;
  concurrentClaimsMax: number;

  // soft signals
  confirmsToday: number;
  ownsLast7d: number;

  // ip-level burst visibility (for debugging)
  ipPreviewLastMin?: number;
};

export type GuardDecision = {
  ok: boolean;
  reason?: string;
  quotas: GuardQuotas;
};

const envNum = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

async function getPlan(userId: string | null): Promise<Plan> {
  if (!userId) return 'free';
  const r = await q<{ user_prefs: any }>('SELECT user_prefs FROM app_user WHERE id=$1', [userId]);
  const plan = (r.rows[0]?.user_prefs?.plan || 'free').toString().toLowerCase();
  if (plan === 'pro' || plan === 'enterprise') return plan as Plan;
  return 'free';
}

function capsFor(plan: Plan) {
  return {
    revealsPerDay: plan === 'enterprise'
      ? Infinity
      : envNum(plan === 'pro' ? 'GUARD_REVEALS_PER_DAY_PRO' : 'GUARD_REVEALS_PER_DAY_FREE', plan === 'pro' ? 30 : 2),
    previewsPerMin: plan === 'enterprise'
      ? Infinity
      : envNum(plan === 'pro' ? 'GUARD_PREVIEW_PER_MIN_PRO' : 'GUARD_PREVIEW_PER_MIN_FREE', plan === 'pro' ? 60 : 12),
    minHoldMs: envNum(plan === 'pro' ? 'GUARD_MIN_HOLD_MS_PRO' : 'GUARD_MIN_HOLD_MS_FREE', plan === 'pro' ? 800 : 1200),
    maxHoldMs: envNum(plan === 'pro' ? 'GUARD_MAX_HOLD_MS_PRO' : 'GUARD_MAX_HOLD_MS_FREE', plan === 'pro' ? 1800 : 3500),
    claimsConcurrent: plan === 'enterprise'
      ? Infinity
      : envNum(plan === 'pro' ? 'GUARD_CLAIMS_CONCURRENT_PRO' : 'GUARD_CLAIMS_CONCURRENT_FREE', plan === 'pro' ? 3 : 1),
  };
}

function ipFrom(req: Request) {
  const xf = (req.headers['x-forwarded-for'] as string) || '';
  const ip = (xf.split(',')[0] || req.socket.remoteAddress || '').trim();
  return ip || '0.0.0.0';
}

async function countsFor(userId: string | null, ip?: string) {
  const nowSql = `now()`;
  const uid = userId || null;

  // Parallel queries
  const [
    revealsTodayQ,
    previewsMinQ,
    confirmsTodayQ,
    owns7dQ,
    claimsQ,
    ipPreviewMinQ
  ] = await Promise.all([
    q<{ n: string }>(`SELECT COUNT(*) n FROM event_log WHERE user_id ${uid? '=$1' : 'IS NULL'} AND event_type='reveal' AND created_at::date = (now() AT TIME ZONE 'utc')::date`, uid? [uid] : []),
    q<{ n: string }>(`SELECT COUNT(*) n FROM event_log WHERE user_id ${uid? '=$1' : 'IS NULL'} AND event_type='preview' AND created_at > ${nowSql} - interval '60 seconds'`, uid? [uid] : []),
    q<{ n: string }>(`SELECT COUNT(*) n FROM event_log WHERE user_id ${uid? '=$1' : 'IS NULL'} AND event_type='confirm_ad' AND created_at::date = (now() AT TIME ZONE 'utc')::date`, uid? [uid] : []),
    q<{ n: string }>(`SELECT COUNT(*) n FROM event_log WHERE user_id ${uid? '=$1' : 'IS NULL'} AND event_type='own' AND created_at > ${nowSql} - interval '7 days'`, uid? [uid] : []),
    q<{ n: string }>(`SELECT COUNT(*) n FROM claim_window WHERE user_id ${uid? '=$1' : 'IS NULL'} AND reserved_until > ${nowSql}`, uid? [uid] : []),
    ip
      ? q<{ n: string }>(`SELECT COUNT(*) n FROM event_log WHERE meta->>'ip'=$1 AND event_type='preview' AND created_at > ${nowSql} - interval '60 seconds'`, [ip])
      : Promise.resolve({ rows: [{ n: '0' }] } as any)
  ]);

  return {
    revealsToday: Number(revealsTodayQ.rows[0]?.n || 0),
    previewsLastMin: Number(previewsMinQ.rows[0]?.n || 0),
    confirmsToday: Number(confirmsTodayQ.rows[0]?.n || 0),
    ownsLast7d: Number(owns7dQ.rows[0]?.n || 0),
    concurrentClaims: Number(claimsQ.rows[0]?.n || 0),
    ipPreviewLastMin: Number(ipPreviewMinQ.rows[0]?.n || 0),
  };
}

function computeScore(inputs: {
  plan: Plan;
  revealsToday: number;
  previewsLastMin: number;
  confirmsToday: number;
  ownsLast7d: number;
  caps: ReturnType<typeof capsFor>;
}) {
  const base = envNum('GUARD_SCORE_BASE', 100);
  const costReveal = envNum('GUARD_SCORE_COST_REVEAL', 12);
  const costPreviewBurst = envNum('GUARD_SCORE_COST_PREVIEW_BURST', 3);
  const rewardConfirm = envNum('GUARD_SCORE_REWARD_CONFIRM', 6);
  const rewardOwn = envNum('GUARD_SCORE_REWARD_OWN', 10);

  let s = base;

  // Penalize reveals proportionally to free cap
  if (inputs.caps.revealsPerDay !== Infinity) {
    s -= costReveal * inputs.revealsToday;
  }

  // Penalize bursts beyond soft limit of previews/min
  if (inputs.caps.previewsPerMin !== Infinity && inputs.previewsLastMin > inputs.caps.previewsPerMin) {
    const extra = inputs.previewsLastMin - inputs.caps.previewsPerMin;
    s -= extra * costPreviewBurst;
  }

  // Reward positive intent signals
  s += inputs.confirmsToday * rewardConfirm;
  s += Math.min(3, inputs.ownsLast7d) * rewardOwn;

  return clamp(s, 0, 100);
}

function holdMsFor(score: number, caps: ReturnType<typeof capsFor>) {
  // Lower score → longer hold
  const t = 1 - (score / 100);
  const ms = Math.round(caps.minHoldMs + t * (caps.maxHoldMs - caps.minHoldMs));
  return clamp(ms, caps.minHoldMs, caps.maxHoldMs);
}

export async function guardStatus(req: Request): Promise<GuardDecision> {
  const userId = (req as any).userId || null;
  const ip = ipFrom(req);
  const plan = await getPlan(userId);
  const caps = capsFor(plan);
  const c = await countsFor(userId, ip);
  const score = computeScore({ plan, caps, ...c });

  // IP global burst ceiling (very high, just to deter scraping)
  const ipBurstMax = envNum('GUARD_IP_BURST_PER_MIN', 90);
  let cooldownSec = 0;
  let ok = true;
  let reason: string | undefined = undefined;

  // Hard block if score too low
  const blockBelow = envNum('GUARD_BLOCK_BELOW_SCORE', 25);
  if (score < blockBelow) {
    ok = false;
    reason = 'low_score';
    cooldownSec = 60;
  }

  // IP burst check
  if (ok && ip && c.ipPreviewLastMin > ipBurstMax) {
    ok = false;
    reason = 'ip_burst';
    cooldownSec = 30;
  }

  const quotas: GuardQuotas = {
    plan,
    score,
    pressHoldMs: holdMsFor(score, caps),
    cooldownSec,

    revealsToday: c.revealsToday,
    revealsMax: caps.revealsPerDay === Infinity ? Number.MAX_SAFE_INTEGER : caps.revealsPerDay,
    previewsLastMin: c.previewsLastMin,
    previewsPerMinMax: caps.previewsPerMin === Infinity ? Number.MAX_SAFE_INTEGER : caps.previewsPerMin,

    concurrentClaims: c.concurrentClaims,
    concurrentClaimsMax: caps.claimsConcurrent === Infinity ? Number.MAX_SAFE_INTEGER : caps.claimsConcurrent,

    confirmsToday: c.confirmsToday,
    ownsLast7d: c.ownsLast7d,

    ipPreviewLastMin: c.ipPreviewLastMin,
  };

  return { ok, reason, quotas };
}

async function canDo(
  req: Request,
  action: 'preview'|'reveal'|'claim'|'own'
): Promise<GuardDecision> {
  const status = await guardStatus(req);
  if (!status.ok) return status;

  const { plan, revealsToday, previewsLastMin, concurrentClaims, quotas } = status.quotas;
  const caps = capsFor(plan);

  if (action === 'reveal') {
    if (caps.revealsPerDay !== Infinity && revealsToday >= caps.revealsPerDay) {
      return { ok: false, reason: 'reveal_quota', quotas };
    }
  }

  if (action === 'preview') {
    if (caps.previewsPerMin !== Infinity && previewsLastMin >= caps.previewsPerMin) {
      return { ok: false, reason: 'preview_burst', quotas: { ...quotas, cooldownSec: 15 } };
    }
  }

  if (action === 'claim') {
    if (caps.claimsConcurrent !== Infinity && concurrentClaims >= caps.claimsConcurrent) {
      return { ok: false, reason: 'claim_concurrent_limit', quotas };
    }
  }

  // 'own' is allowed if claim flow already opened a window (handled by your own endpoint).
  return status;
}

export function guardMiddleware(action: 'preview'|'reveal'|'claim'|'own') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const d = await canDo(req, action);
      if (!d.ok) {
        return res.status(429).json({ ok: false, reason: d.reason, quotas: d.quotas });
      }
      next();
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  };
}

export async function logGuardEvent(
  req: Request,
  type: 'preview'|'reveal'|'claim'|'own'|'confirm_ad',
  meta?: Record<string, any>
) {
  const userId = (req as any).userId || null;
  const ip = ipFrom(req);
  const m = { ...(meta || {}), ip };
  await q(`INSERT INTO event_log (user_id, event_type, meta) VALUES ($1,$2,$3)`, [userId, type, m]);
}

// Helper: for front-end polling — return only the quotas (no block) to drive UI (hold-ms, etc.)
export async function quotasOnly(req: Request): Promise<GuardQuotas> {
  const d = await guardStatus(req);
  return d.quotas;
}
