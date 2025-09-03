// /Backend/src/index.ts
import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

/**
 * Galactly API — self-contained dev-friendly server
 * - DEV_UNLIMITED (default: true) forces large quotas so the UI never blocks
 * - No DB required; in-memory state for quotas & presence
 * - Mounts both /... and /api/v1/... to avoid path mismatches
 */

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ----------------------- ENV & flags -----------------------
function flag(name: string, def = false): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (!v) return def;
  return ['1','true','yes','y','on'].includes(v);
}
const PORT = Number(process.env.PORT || 8787);

// Default ON during build so you can test easily.
// Turn OFF later by setting DEV_UNLIMITED=false in your service env.
let DEV_UNLIMITED = flag('DEV_UNLIMITED', true);

// ----------------------- Helpers -----------------------
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
  verified?: boolean;    // for future gating
};

const users = new Map<string, UserState>();

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
function getUID(req: Request): string {
  const h = (req.header('x-galactly-user') || req.header('x-user-id') || '').trim();
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
        findsLimit: DEV_UNLIMITED ? 999 : Number(process.env.FREE_FINDS_PER_DAY || 2),
        revealsLimit: DEV_UNLIMITED ? 999 : Number(process.env.FREE_REVEALS_PER_DAY || 2),
      },
      verified: false
    };
    users.set(uid, s);
  }
  // rollover at UTC midnight
  if (s.quota.date !== now) {
    s.quota = {
      date: now,
      findsUsed: 0,
      revealsUsed: 0,
      findsLimit: s.plan === 'pro'
        ? (DEV_UNLIMITED ? 999 : Number(process.env.PRO_FINDS_PER_DAY || 50))
        : (DEV_UNLIMITED ? 999 : Number(process.env.FREE_FINDS_PER_DAY || 2)),
      revealsLimit: s.plan === 'pro'
        ? (DEV_UNLIMITED ? 999 : Number(process.env.PRO_REVEALS_PER_DAY || 100))
        : (DEV_UNLIMITED ? 999 : Number(process.env.FREE_REVEALS_PER_DAY || 2)),
    };
  }
  return s;
}
function searchesLeft(s: UserState) {
  return Math.max(0, s.quota.findsLimit - s.quota.findsUsed);
}
function revealsLeft(s: UserState) {
  return Math.max(0, s.quota.revealsLimit - s.quota.revealsUsed);
}
function unlimitedFromReq(req: Request) {
  // env OR header OR query can flip unlim for testing
  return DEV_UNLIMITED ||
    ['true','1','yes','on'].includes(String(req.header('x-dev-unlim') || '').toLowerCase()) ||
    ['true','1','yes','on'].includes(String(req.query.dev || '').toLowerCase());
}

// ----------------------- Presence (in-memory) -----------------------
type Beat = { last: number; role?: string };
const presence = new Map<string, Beat>();
const PRESENCE_TTL = 30_000;

setInterval(() => {
  const cutoff = Date.now() - PRESENCE_TTL;
  for (const [k,v] of presence) if (v.last < cutoff) presence.delete(k);
}, 5_000);

// mount helper to register and also mirror under /api/v1
type Method = 'get'|'post'|'put'|'delete';
const ROUTES: Array<{ method: Method; path: string }> = [];
function reg(method: Method, path: string, handler: any) {
  ROUTES.push({ method, path });
  (app as any)[method](path, handler);
}
function mirror(method: Method, path: string, handler: any) {
  const p = path.startsWith('/') ? path : `/${path}`;
  reg(method, p, handler);
  reg(method, `/api/v1${p}`, handler);
}

// ----------------------- Health & debug -----------------------
mirror('get', '/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));
reg('get', '/', (_req, res) => res.json({ ok: true, name: 'Galactly API', version: 'dev', time: Date.now() }));
reg('get', '/__routes', (_req, res) => res.json({ ok: true, routes: ROUTES }));

// ----------------------- Presence routes -----------------------
mirror('get', '/presence/online', (_req, res) => {
  let suppliers=0, distributors=0, buyers=0;
  for (const v of presence.values()) {
    const r = (v.role || '').toLowerCase();
    if (r === 'supplier') suppliers++;
    else if (r==='distributor'||r==='wholesaler') distributors++;
    else if (r === 'buyer') buyers++;
  }
  res.json({ ok:true, total: presence.size, suppliers, distributors, buyers });
});
mirror('post', '/presence/beat', (req, res) => {
  const uid = getUID(req);
  const role = String((req.body?.role || '')).toLowerCase();
  presence.set(uid, { last: Date.now(), role: role || undefined });
  res.json({ ok: true });
});

// ----------------------- Status / gate / vault -----------------------
mirror('get', '/status', (req: Request, res: Response) => {
  const uid = getUID(req);
  const s = ensureUser(uid);
  const devUnlim = unlimitedFromReq(req);
  // reflect dev flag in response
  res.json({
    ok: true,
    uid,
    plan: s.plan,
    verified: !!s.verified,
    quota: {
      date: s.quota.date,
      findsUsed: s.quota.findsUsed,
      revealsUsed: s.quota.revealsUsed,
      findsLeft: devUnlim ? 999 : searchesLeft(s),
      revealsLeft: devUnlim ? 999 : revealsLeft(s),
    },
    devUnlimited: devUnlim
  });
});

mirror('post', '/gate', (req: Request, res: Response) => {
  const uid = getUID(req);
  const s = ensureUser(uid);
  const { email, role, website } = req.body || {};
  if (role && typeof role === 'string') s.role = role;
  // If you want to mark verified when email domain == website domain, do it here later.
  res.json({ ok: true, uid, plan: s.plan, role: s.role || null, website: website || null });
});

mirror('post', '/vault', (req: Request, res: Response) => {
  const uid = getUID(req);
  ensureUser(uid);
  // Accept & ack; can store later.
  res.json({ ok: true, uid });
});

// ----------------------- Find / Reveal (quota-aware, but dev-friendly) -----------------------
mirror('post', '/find-now', (req: Request, res: Response) => {
  const uid = getUID(req);
  const s = ensureUser(uid);
  const unlim = unlimitedFromReq(req);

  if (!unlim && searchesLeft(s) <= 0) {
    return res.status(429).json({ ok:false, error:'quota', message:'Daily search quota reached' });
  }
  if (!unlim) s.quota.findsUsed++;

  // kick a synthetic preview job id if you want to poll or SSE
  res.json({ ok:true, created: 7, jobId: `job_${Date.now()}` });
});

mirror('post', '/reveal', (req: Request, res: Response) => {
  const uid = getUID(req);
  const s = ensureUser(uid);
  const unlim = unlimitedFromReq(req);

  if (!unlim && revealsLeft(s) <= 0) {
    return res.status(429).json({ ok:false, error:'quota', message:'Reveal quota reached' });
  }
  if (!unlim) s.quota.revealsUsed++;
  res.json({ ok:true, revealed:true });
});

// ----------------------- Simple SSE for Signals Preview -----------------------
mirror('get', '/progress.sse', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (obj: any) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  // few synthetic steps so UI can animate
  let i = 0;
  const steps = [
    { lane: 'free', category:'Demand',    probe:'ad libs',     filter:'packaging terms', evidence:'spend proxy', conclusion:'corrugate usage' },
    { lane: 'free', category:'Product',   probe:'PDP deltas',  filter:'size packs',      evidence:'variants ↑',  conclusion:'SKU restock'   },
    { lane: 'pro',  category:'Timing',    probe:'promo cad.',  filter:'price drops',     evidence:'retailer feed', conclusion:'queue window' },
    { lane: 'pro',  category:'Reviews',   probe:'complaints',  filter:'pack lexicon',    evidence:'“box crushed”', conclusion:'switch risk'  }
  ];

  const t = setInterval(() => {
    const s = steps[i % steps.length];
    const freeDone = Math.min(60, i * 2 + 3);
    const freeTotal = 1126;
    const proDone = Math.min(840, i * 14 + 20);
    const proTotal = 1126;
    send({ type:'step', lane:s.lane, category:s.category, probe:s.probe, filter:s.filter, evidence:s.evidence, conclusion:s.conclusion, freeDone, freeTotal, proDone, proTotal });
    i++;
    if (i > 32) {
      send({ type:'halt' }); // free lane halts early
      clearInterval(t);
      res.end();
    }
  }, 900);
  req.on('close', () => { clearInterval(t); });
});

// ----------------------- 404 -----------------------
app.use((_req, res) => res.status(404).json({ ok:false, error:'not_found' }));

// ----------------------- Start -----------------------
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}  DEV_UNLIMITED=${DEV_UNLIMITED}`);
});
