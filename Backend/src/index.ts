// /Backend/src/index.ts
import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

/**
 * Galactly API — dev-friendly bootstrap
 * - Quotas: HARD-OVERRIDDEN to "unlimited" for now (always 999 shown in /status)
 * - Works without a DB (in-memory state)
 * - Mirrors endpoints under both /... and /api/v1/... to avoid path mismatches
 */

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------- HARD DEV OVERRIDE (always unlimited until you say otherwise) ----------
const FORCE_UNLIMITED = true; // <— leave true for now so the UI never shows "0 left"
const PORT = Number(process.env.PORT || 8787);

// ---------- Helpers ----------
type Quota = {
  date: string;
  findsUsed: number;
  revealsUsed: number;
  findsLimit: number;
  revealsLimit: number;
};
type UserState = {
  uid: string;
  role?: string;
  plan: 'free'|'pro';
  quota: Quota;
  verified?: boolean;
};

const users = new Map<string, UserState>();
type Beat = { last: number; role?: string };
const presence = new Map<string, Beat>();
const PRESENCE_TTL = 30_000;

function todayUTC(): string { return new Date().toISOString().slice(0,10); }
function getUID(req: Request): string {
  return (req.header('x-galactly-user') || req.header('x-user-id') || `u-${randomUUID().replace(/-/g,'').slice(0,12)}`).toString();
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
        findsLimit: FORCE_UNLIMITED ? 999 : Number(process.env.FREE_FINDS_PER_DAY || 2),
        revealsLimit: FORCE_UNLIMITED ? 999 : Number(process.env.FREE_REVEALS_PER_DAY || 2),
      },
      verified: false
    };
    users.set(uid, s);
  }
  if (s.quota.date !== now) {
    s.quota = {
      date: now,
      findsUsed: 0,
      revealsUsed: 0,
      findsLimit: FORCE_UNLIMITED ? 999 : (s.plan === 'pro' ? Number(process.env.PRO_FINDS_PER_DAY || 50) : Number(process.env.FREE_FINDS_PER_DAY || 2)),
      revealsLimit: FORCE_UNLIMITED ? 999 : (s.plan === 'pro' ? Number(process.env.PRO_REVEALS_PER_DAY || 100) : Number(process.env.FREE_REVEALS_PER_DAY || 2)),
    };
  }
  return s;
}
function searchesLeft(s: UserState){ return Math.max(0, s.quota.findsLimit - s.quota.findsUsed); }
function revealsLeft(s: UserState){ return Math.max(0, s.quota.revealsLimit - s.quota.revealsUsed); }

// route reg helpers (and mirror under /api/v1)
type Method = 'get'|'post'|'put'|'delete';
const ROUTES: Array<{method: Method; path: string}> = [];
function reg(method: Method, path: string, handler: any) {
  ROUTES.push({method, path});
  (app as any)[method](path, handler);
}
function mirror(method: Method, path: string, handler: any) {
  const p = path.startsWith('/') ? path : `/${path}`;
  reg(method, p, handler);
  reg(method, `/api/v1${p}`, handler);
}

// ---------- Health & debug ----------
mirror('get', '/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));
reg('get', '/', (_req, res) => res.json({ ok: true, name: 'Galactly API', version: 'dev', time: Date.now() }));
reg('get', '/__routes', (_req, res) => res.json({ ok: true, routes: ROUTES }));

// ---------- Presence ----------
setInterval(() => {
  const cutoff = Date.now() - PRESENCE_TTL;
  for (const [k,v] of presence) if (v.last < cutoff) presence.delete(k);
}, 5_000);

mirror('get', '/presence/online', (_req, res) => {
  let suppliers=0, distributors=0, buyers=0;
  for (const v of presence.values()) {
    const r = (v.role || '').toLowerCase();
    if (r==='supplier') suppliers++;
    else if (r==='distributor' || r==='wholesaler') distributors++;
    else if (r==='buyer') buyers++;
  }
  res.json({ ok: true, total: presence.size, suppliers, distributors, buyers });
});

mirror('post', '/presence/beat', (req, res) => {
  const uid = getUID(req);
  const role = String((req.body?.role || '')).toLowerCase();
  presence.set(uid, { last: Date.now(), role: role || undefined });
  res.json({ ok: true });
});

// ---------- Status / Gate / Vault ----------
mirror('get', '/status', (req: Request, res: Response) => {
  const uid = getUID(req);
  const s = ensureUser(uid);
  // ALWAYS show huge quota while we’re building
  res.json({
    ok: true,
    uid,
    plan: s.plan,
    verified: !!s.verified,
    quota: {
      date: s.quota.date,
      findsUsed: 0,
      revealsUsed: 0,
      findsLeft: 999,
      revealsLeft: 999
    },
    devUnlimited: true
  });
});

mirror('post', '/gate', (req: Request, res: Response) => {
  const uid = getUID(req);
  const s = ensureUser(uid);
  const { role, website } = req.body || {};
  if (role && typeof role === 'string') s.role = role;
  res.json({ ok: true, uid, plan: s.plan, role: s.role || null, website: website || null });
});

mirror('post', '/vault', (req: Request, res: Response) => {
  const uid = getUID(req);
  ensureUser(uid);
  res.json({ ok: true, uid });
});

// ---------- Find / Reveal (no quota errors while building) ----------
mirror('post', '/find-now', (req: Request, res: Response) => {
  const uid = getUID(req);
  ensureUser(uid);
  res.json({ ok: true, created: 7, jobId: `job_${Date.now()}` });
});

mirror('post', '/reveal', (req: Request, res: Response) => {
  const uid = getUID(req);
  ensureUser(uid);
  res.json({ ok: true, revealed: true });
});

// ---------- Simple SSE for Signals Preview ----------
mirror('get', '/progress.sse', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (obj: any) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  let i = 0;
  const steps = [
    { lane: 'free', category:'Demand',    probe:'ad libs',    filter:'packaging terms', evidence:'spend proxy',   conclusion:'corrugate usage' },
    { lane: 'free', category:'Product',   probe:'PDP deltas', filter:'size packs',       evidence:'variants ↑',    conclusion:'SKU restock'   },
    { lane: 'pro',  category:'Timing',    probe:'promo cad.', filter:'price drops',      evidence:'retailer feed', conclusion:'queue window'   },
    { lane: 'pro',  category:'Reviews',   probe:'complaints', filter:'pack lexicon',     evidence:'“box crushed”', conclusion:'switch risk'    }
  ];

  const t = setInterval(() => {
    const s = steps[i % steps.length];
    send({ type:'step', ...s, freeDone: Math.min(60, i*2+3), freeTotal: 1126, proDone: Math.min(840, i*14+20), proTotal: 1126 });
    i++;
    if (i > 28) { send({ type:'halt' }); clearInterval(t); res.end(); }
  }, 900);

  req.on('close', () => clearInterval(t));
});

// ---------- 404 ----------
app.use((_req, res) => res.status(404).json({ ok:false, error:'not_found' }));

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}  FORCE_UNLIMITED=${FORCE_UNLIMITED}`);
});
