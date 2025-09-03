// src/Index.ts
// Galactly lightweight API (in-memory) with sane defaults + daily quota reset.
// Fixes: zero searches left on first load, robust env parsing, dev-unlimited applied consistently.

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

// ------------------------ Config & helpers ------------------------

function num(v: any, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}
function todayUTC(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

const PORT = num(process.env.PORT, 8787);

// Daily limits (sane defaults, never 0)
const FREE_FINDS_PER_DAY    = Math.max(1, num(process.env.FREE_FINDS_PER_DAY, 2));
const FREE_REVEALS_PER_DAY  = Math.max(1, num(process.env.FREE_REVEALS_PER_DAY, 2));

// Optional PRO limits (kept generous, still bounded)
const PRO_FINDS_PER_DAY     = Math.max(FREE_FINDS_PER_DAY,   num(process.env.PRO_FINDS_PER_DAY, 50));
const PRO_REVEALS_PER_DAY   = Math.max(FREE_REVEALS_PER_DAY, num(process.env.PRO_REVEALS_PER_DAY, 200));

const ENGINE_READY = true;

// ------------------------ In-memory stores ------------------------

type Quota = {
  date: string; // UTC YYYY-MM-DD
  findsUsed: number;
  revealsUsed: number;
};

type Traits = {
  vendorDomain?: string | null;
  industries?: string[];
  regions?: string[];
  buyers?: string[];
  notes?: string | null;
};

type UserPrefs = {
  uid: string;
  email?: string;
  role?: 'supplier'|'distributor'|'buyer';
  plan: 'free'|'pro';
  quota: Quota;
  traits: Traits;
  createdAt: number;
  lastSeenAt: number;
};

const users = new Map<string, UserPrefs>();

// Presence (very light)
type PresenceRow = { uid: string; role?: string; plan?: 'free'|'pro'; ts: number };
const presence = new Map<string, PresenceRow>();

// Leads pool (per user) – demo data only
type Lead = {
  id: string;
  name: string;
  intent: string[];
  confidence: number; // 0..1
  platform: string;   // for rotation demo
  createdAt: number;
  ownerUid?: string;
};
const userLeadPools = new Map<string, Lead[]>();

// ------------------------ Core helpers ------------------------

function getUid(req: Request): string {
  const h = (req.headers['x-galactly-user'] || '').toString().trim();
  if (h) return h;
  // last resort: ip-based (not great, only for dev)
  return 'ip_' + (req.ip || req.socket.remoteAddress || 'x');
}

function getOrCreateUser(uid: string): UserPrefs {
  let u = users.get(uid);
  if (!u) {
    u = {
      uid,
      plan: 'free',
      quota: { date: todayUTC(), findsUsed: 0, revealsUsed: 0 },
      traits: {},
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    users.set(uid, u);
  }
  // daily reset
  if (u.quota.date !== todayUTC()) {
    u.quota = { date: todayUTC(), findsUsed: 0, revealsUsed: 0 };
  }
  u.lastSeenAt = Date.now();
  return u;
}

function isDevUnlim(req: Request): boolean {
  return (req.headers['x-galactly-dev'] || '').toString().toLowerCase() === 'unlim';
}

function limitsFor(u: UserPrefs) {
  return u.plan === 'pro'
    ? { finds: PRO_FINDS_PER_DAY, reveals: PRO_REVEALS_PER_DAY }
    : { finds: FREE_FINDS_PER_DAY, reveals: FREE_REVEALS_PER_DAY };
}

function searchesLeft(u: UserPrefs, devUnlim: boolean): number {
  if (devUnlim) return 9999;
  const L = limitsFor(u);
  return Math.max(0, L.finds - u.quota.findsUsed);
}
function revealsLeft(u: UserPrefs, devUnlim: boolean): number {
  if (devUnlim) return 9999;
  const L = limitsFor(u);
  return Math.max(0, L.reveals - u.quota.revealsUsed);
}

function seedDemoLeads(uid: string, n: number) {
  const pool = userLeadPools.get(uid) || [];
  const platforms = ['reddit','google','procure','jobs','pdp','reviews','events'];
  for (let i=0;i<n;i++){
    const id = randomUUID();
    pool.push({
      id,
      name: `Brand ${id.slice(0,5).toUpperCase()}`,
      intent: ['demand','product','reviews'].slice(0, Math.floor(Math.random()*3)+1),
      confidence: 0.65 + Math.random()*0.3,
      platform: platforms[(pool.length+i)%platforms.length],
      createdAt: Date.now()
    });
  }
  userLeadPools.set(uid, pool);
}

// ------------------------ App ------------------------

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(bodyParser.json());

// --- tiny logger for visibility
app.use((req,_res,next)=>{
  const uid = getUid(req);
  const dev = isDevUnlim(req);
  // eslint-disable-next-line no-console
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} uid=${uid} dev=${dev?'yes':'no'}`);
  next();
});

// ------------------------ Presence ------------------------

app.get('/presence/online', (req,res)=>{
  const now = Date.now();
  const rows = [...presence.values()].filter(r => now - r.ts < 30_000);
  const total = rows.length;
  const breakdown = rows.reduce((acc, r)=>{
    const k = r.role || 'unknown';
    acc[k] = (acc[k]||0)+1;
    return acc;
  }, {} as Record<string, number>);
  res.json({ total, breakdown });
});

app.post('/presence/beat', (req,res)=>{
  const uid = getUid(req);
  const u = getOrCreateUser(uid);
  presence.set(uid, { uid, role: u.role, plan: u.plan, ts: Date.now() });
  res.json({ ok:true });
});

// ------------------------ Health / debug ------------------------

app.get('/api/v1/healthz', (_req,res)=> res.json({ ok:true, engine: ENGINE_READY }));
app.get('/__routes', (_req,res)=>{
  res.json(app._router?.stack
    ?.filter((r:any)=>r.route)
    ?.map((r:any)=>({ method:Object.keys(r.route.methods)[0].toUpperCase(), path:r.route.path })));
});

// ------------------------ Gate / Vault ------------------------

app.post('/api/v1/gate', (req,res)=>{
  const uid = getUid(req);
  const u = getOrCreateUser(uid);
  const { email, region } = req.body || {};
  if (email) u.email = String(email);
  if (region) {
    const rg = String(region).split(',').map((s:string)=>s.trim()).filter(Boolean);
    u.traits.regions = rg;
  }
  // store presence
  presence.set(uid, { uid, role: u.role, plan: u.plan, ts: Date.now() });
  res.json({ ok:true, plan:u.plan });
});

app.post('/api/v1/vault', (req,res)=>{
  const uid = getUid(req);
  const u = getOrCreateUser(uid);
  const { role, traits, listMe } = req.body || {};
  if (role) u.role = role;
  if (traits && typeof traits === 'object') {
    u.traits = { ...(u.traits||{}), ...traits };
  }
  if (listMe) {
    // no-op in demo; could push into a public listing table
  }
  res.json({ ok:true, prefs:u });
});

app.get('/api/v1/vault', (req,res)=>{
  const uid = getUid(req);
  const u = getOrCreateUser(uid);
  res.json({ ok:true, prefs: u });
});

// ------------------------ Status & Quotas ------------------------

app.get('/api/v1/status', (req,res)=>{
  const uid = getUid(req);
  const u = getOrCreateUser(uid); // ensures quota row exists & daily reset occurs
  const dev = isDevUnlim(req);

  presence.set(uid, { uid, role: u.role, plan: u.plan, ts: Date.now() });

  const searches = searchesLeft(u, dev);
  const reveals = revealsLeft(u, dev);

  res.json({
    ok:true,
    engineReady: ENGINE_READY,
    plan: u.plan,
    searchesLeft: searches,
    revealsLeft: reveals,
    // lightweight flags for panel header
    limits: dev ? { finds: 'unlimited', reveals: 'unlimited' } : limitsFor(u),
    today: u.quota.date
  });
});

// ------------------------ Leads & find-now ------------------------

app.get('/api/v1/leads', (req,res)=>{
  const uid = getUid(req);
  const pool = userLeadPools.get(uid) || [];
  // rotate / enforce platform diversity (simple)
  const out = pool.slice(-8);
  res.json({ ok:true, leads: out });
});

app.post('/api/v1/find-now', (req,res)=>{
  const uid = getUid(req);
  const u = getOrCreateUser(uid);
  const dev = isDevUnlim(req);

  const left = searchesLeft(u, dev);
  if (left <= 0 && !dev) {
    return res.status(429).json({ ok:false, created:0, reason:'quota', searchesLeft:left });
  }

  // pretend collectors run and seed 3–6 fresh items
  const created = 3 + Math.floor(Math.random()*4);
  seedDemoLeads(uid, created);

  // decrement only when not dev
  if (!dev) {
    u.quota.findsUsed += 1;
  }

  res.json({
    ok:true,
    created,
    searchesLeft: searchesLeft(u, dev),
  });
});

// Claim / own demo endpoints
app.post('/api/v1/claim', (req,res)=>{
  const uid = getUid(req);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok:false, error:'missing id' });
  const pool = userLeadPools.get(uid) || [];
  const lead = pool.find(l => l.id === id);
  if (!lead) return res.status(404).json({ ok:false, error:'not found' });
  lead.ownerUid = uid; // 2-min window in real impl
  res.json({ ok:true, reserved:true });
});

app.post('/api/v1/own', (req,res)=>{
  const uid = getUid(req);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok:false, error:'missing id' });
  const pool = userLeadPools.get(uid) || [];
  const lead = pool.find(l => l.id === id);
  if (!lead) return res.status(404).json({ ok:false, error:'not found' });
  lead.ownerUid = uid;
  res.json({ ok:true, owned:true });
});

// ------------------------ Progress SSE (stubbed, Free halts early) ------------------------

app.get('/api/v1/progress.sse', (req,res)=>{
  const uid = getUid(req);
  const u = getOrCreateUser(uid);
  const dev = isDevUnlim(req);

  res.writeHead(200, {
    'Content-Type':'text/event-stream',
    'Cache-Control':'no-cache',
    Connection:'keep-alive'
  });

  let i = 0;
  const lines = [
    { cat:'Demand',   free:'Ad library scan → 265 creatives → est. reach high', pro:'Spend split by geo/creative → multi-touch path' },
    { cat:'Product',  free:'SKU deltas → new size-pack hints',                   pro:'Cart velocity → units/day → packaging SKUs' },
    { cat:'Procure',  free:'Supplier portals found',                             pro:'Intake forms + SLA text → contact windows' },
    { cat:'Reviews',  free:'Complaint lexicon ping',                             pro:'Surge detection (packaging) → switch timing' },
    { cat:'Timing',   free:'Post cadence observed',                              pro:'Best hour/day windows by segment' },
  ];

  const t = setInterval(()=>{
    if (i >= lines.length) {
      res.write(`event:halt\ndata:${JSON.stringify({ reason:'free_halt' })}\n\n`);
      res.end();
      clearInterval(t);
      return;
    }
    const row = lines[i++];
    res.write(`data:${JSON.stringify({
      step:i,
      cat: row.cat,
      free: row.free,
      pro:  row.pro,
      locked: true
    })}\n\n`);
  }, dev ? 250 : 800);

  req.on('close', ()=> clearInterval(t));
});

// ------------------------ Billing upgrade (stub) ------------------------

app.post('/api/v1/upgrade/dev', (req,res)=>{
  // dev helper: flip plan to pro without Stripe
  const uid = getUid(req);
  const u = getOrCreateUser(uid);
  u.plan = 'pro';
  // when becoming pro we do NOT reset usage; we simply change limits
  res.json({ ok:true, plan:u.plan, limits: limitsFor(u) });
});

// ------------------------ Start ------------------------

app.listen(PORT, ()=> {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${PORT}`);
});
