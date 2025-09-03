import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

/**
 * Galactly API bootstrap (minimal, self-contained)
 * - Fixes 404s for /healthz and /presence/online
 * - Returns non-zero quotas for /api/v1/status
 * - Provides /api/v1/find-now to decrement quotas
 * - Mirrors routes under both / and /api/v1 prefixes
 */

const PORT = Number(process.env.PORT || 8787);
const DEV_UNLIM =
  String(process.env.DEV_UNLIM || '').toLowerCase() === 'true' ||
  String(process.env.NODE_ENV || '').toLowerCase() === 'development';

// --------- In-memory stores (ok for MVP) ----------
type Quota = {
  date: string;        // UTC YYYY-MM-DD
  findsUsed: number;
  revealsUsed: number;
  findsLimit: number;  // daily
  revealsLimit: number;
};
type UserState = {
  uid: string;
  role?: string;
  plan: 'free'|'pro';
  quota: Quota;
};

const users = new Map<string, UserState>();

// presence: heartbeat registry
type Beat = { last: number; role?: string };
const presence = new Map<string, Beat>();
const PRESENCE_TTL = 30_000; // 30s online window
setInterval(() => {
  const cutoff = Date.now() - PRESENCE_TTL;
  for (const [k, v] of presence) if (v.last < cutoff) presence.delete(k);
}, 5_000);

// ---------- helpers ----------
function todayUTC(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function getUID(req: Request): string {
  // sticky uid from header or generate a session one
  const h = (req.header('x-galactly-user') || '').trim();
  return h || `u-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
function ensureUser(uid: string): UserState {
  const now = todayUTC();
  let s = users.get(uid);
  if (!s) {
    s = {
      uid,
      plan: 'free',
      quota: {
        date: now,
        findsUsed: 0,
        revealsUsed: 0,
        findsLimit: DEV_UNLIM ? 9999 : Number(process.env.FREE_FINDS_PER_DAY || 2),
        revealsLimit: DEV_UNLIM ? 9999 : Number(process.env.FREE_REVEALS_PER_DAY || 2),
      },
    };
    users.set(uid, s);
  }
  // reset quota at UTC midnight
  if (s.quota.date !== now) {
    s.quota = {
      date: now,
      findsUsed: 0,
      revealsUsed: 0,
      findsLimit: s.plan === 'pro'
        ? Number(process.env.PRO_FINDS_PER_DAY || 50)
        : (DEV_UNLIM ? 9999 : Number(process.env.FREE_FINDS_PER_DAY || 2)),
      revealsLimit: s.plan === 'pro'
        ? Number(process.env.PRO_REVEALS_PER_DAY || 100)
        : (DEV_UNLIM ? 9999 : Number(process.env.FREE_REVEALS_PER_DAY || 2)),
    };
  }
  return s;
}
function searchesLeft(s: UserState): number {
  return Math.max(0, s.quota.findsLimit - s.quota.findsUsed);
}
function revealsLeft(s: UserState): number {
  return Math.max(0, s.quota.revealsLimit - s.quota.revealsUsed);
}

// ---------- express ----------
const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// route registry for /__routes
const ROUTES: Array<{ method: string; path: string }> = [];
function reg(method: string, path: string, handler: any) {
  ROUTES.push({ method, path });
  // @ts-ignore
  app[method](path, handler);
}
function mirror(method: string, path: string, handler: any) {
  reg(method, path, handler);
  // also under /api/v1
  const p = path.startsWith('/') ? path : `/${path}`;
  const api = '/api/v1' + p;
  if (api !== path) reg(method, api, handler);
}

// ---------- health ----------
mirror('get', '/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, ts: Date.now() });
});

// ---------- root + routes ----------
reg('get', '/', (_req, res) => {
  res.json({ ok: true, name: 'Galactly API', version: '1', time: Date.now() });
});
reg('get', '/__routes', (_req, res) => res.json({ ok: true, routes: ROUTES }));

// ---------- presence ----------
mirror('get', '/presence/online', (req: Request, res: Response) => {
  // return counts by role + total
  const total = presence.size;
  let suppliers = 0, distributors = 0, buyers = 0;
  for (const v of presence.values()) {
    const r = (v.role || '').toLowerCase();
    if (r === 'supplier') suppliers++;
    else if (r === 'distributor' || r === 'wholesaler') distributors++;
    else if (r === 'buyer') buyers++;
  }
  res.json({ ok: true, total, suppliers, distributors, buyers });
});

mirror('post', '/presence/beat', (req: Request, res: Response) => {
  const uid = getUID(req);
  const role = String((req.body?.role || '')).toLowerCase();
  presence.set(uid, { last: Date.now(), role: role || undefined });
  res.json({ ok: true });
});

// ---------- status (quotas + plan) ----------
mirror('get', '/api/v1/status', (req: Request, res: Response) => {
  const uid = getUID(req);
  const s = ensureUser(uid);
  res.json({
    ok: true,
    uid,
    plan: s.plan,
    quota: {
      date: s.quota.date,
      findsUsed: s.quota.findsUsed,
      revealsUsed: s.quota.revealsUsed,
      findsLeft: searchesLeft(s),
      revealsLeft: revealsLeft(s),
    },
    devUnlimited: DEV_UNLIM,
  });
});

// ---------- gate (sign-up / upsert) ----------
mirror('post', '/api/v1/gate', (req: Request, res: Response) => {
  const uid = getUID(req);
  const { email, role, website } = req.body || {};
  const s = ensureUser(uid);
  if (role && typeof role === 'string') s.role = role;
  // If a website is provided, you could snapshot its domain here
  res.json({ ok: true, uid, plan: s.plan });
});

// ---------- vault upsert minimal (so Train Your AI can save) ----------
mirror('post', '/api/v1/vault', (req: Request, res: Response) => {
  const uid = getUID(req);
  ensureUser(uid);
  // Accept and ack – storage is optional for now
  res.json({ ok: true, uid });
});

// ---------- find-now (decrement daily finds unless DEV_UNLIM) ----------
mirror('post', '/api/v1/find-now', (req: Request, res: Response) => {
  const uid = getUID(req);
  const s = ensureUser(uid);

  // dev override
  const devHeader = String(req.header('x-dev-unlim') || '').toLowerCase() === 'true';
  const devParam = String(req.query.dev || '').toLowerCase() === '1';
  const unlimited = DEV_UNLIM || devHeader || devParam;

  if (!unlimited && searchesLeft(s) <= 0) {
    return res.status(429).json({ ok: false, error: 'quota', message: 'Daily search quota reached' });
  }
  if (!unlimited) s.quota.findsUsed++;

  // Immediately respond with synthetic counts so UI can show progress
  res.json({ ok: true, created: 7, queued: 0 });
});

// ---------- reveals mock ----------
mirror('post', '/api/v1/reveal', (req: Request, res: Response) => {
  const uid = getUID(req);
  const s = ensureUser(uid);

  const unlimited =
    DEV_UNLIM ||
    String(req.header('x-dev-unlim') || '').toLowerCase() === 'true' ||
    String(req.query.dev || '').toLowerCase() === '1';

  if (!unlimited && revealsLeft(s) <= 0) {
    return res.status(429).json({ ok: false, error: 'quota', message: 'Reveal quota reached' });
  }
  if (!unlimited) s.quota.revealsUsed++;

  res.json({ ok: true, revealed: true });
});

// ---------- 404 fallback ----------
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'not_found' });
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT} (dev-unlim=${DEV_UNLIM})`);
});
