// src/index.ts
//
// Buyers API (compat + real sweeps)
// - Health + routes listing
// - Compat find endpoints used by the free panel
// - Warm list + lock endpoints
// - GitHub-based "deeper results" sweep (Zie619) with optional PAT
// - Open /api/ingest/github endpoint (what your Actions posts to)
//
// Env (optional but recommended):
//   GH_PAT_PUBLIC   -> fine-grained PAT with read-only repo contents (public)
//   PORT            -> defaults 8787

import express, { Request, Response } from 'express';
import cors from 'cors';

// In-memory store (you already have this file)
import {
  saveByHost,
  buckets,
  replaceHotWarm,
  ensureLeadForHost,
  watchers,
  type StoredLead,
  type Temp,
} from './shared/memStore';

// ---------- Types exposed to the panel ----------
type LeadItem = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;
  temp?: 'hot' | 'warm' | 'cold' | string;
  whyText?: string;
};

type ApiOk<T = unknown> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

// ---------- App ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Keep a registry so /routes can show what's mounted
const ROUTES: string[] = [];
function reg(method: string, fullPath: string) {
  ROUTES.push(`${method.toUpperCase()} ${fullPath}`);
}

// ---------- Health ----------
app.get('/healthz', (_req, res) => res.json({ ok: true, msg: 'healthy' }));
reg('GET', '/healthz');

app.get('/routes', (_req, res) => {
  res.json({ ok: true, routes: ROUTES.sort() });
});
reg('GET', '/routes');

// ---------- Small helpers ----------
function toHost(urlLike?: string): string | undefined {
  if (!urlLike) return;
  const s = String(urlLike).trim();
  if (!s) return;

  // If text contains a domain (even without protocol) try to parse it.
  try {
    const u = s.includes('://') ? new URL(s) : new URL('https://' + s);
    let h = (u.hostname || '').toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h.includes('.') ? h : undefined;
  } catch {
    // Fallback: scan for domain-looking token
    const m = s.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
    if (!m) return;
    let h = m[1].toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h.includes('.') ? h : undefined;
  }
}

function toLeadItem(l: StoredLead): LeadItem {
  return {
    host: l.host,
    platform: l.platform || 'web',
    title: l.title || `Possible buyer @ ${l.host}`,
    created: l.created,
    temp: l.temperature,
    whyText: l.why,
  };
}

function sendBad(res: Response, error: string, code = 400) {
  const body: ApiErr = { ok: false, error };
  return res.status(code).json(body);
}

// ---------- COMPAT: one-click "Find buyers" ----------
async function findOneBuyer(host: string, region: string, radius: string): Promise<LeadItem> {
  // Temp compat response so the UI unblocks; we also stash it into memory.
  const created = new Date().toISOString();
  saveByHost(host, {
    title: `Buyer lead for ${host}`,
    platform: 'web',
    created,
    temperature: 'warm',
    why: `Compat shim matched (${region}, ${radius})`,
    saved: true,
  });

  return {
    host,
    platform: 'web',
    title: `Buyer lead for ${host}`,
    created,
    temp: 'warm',
    whyText: `Compat shim matched (${region}, ${radius})`,
  };
}

function pickParams(req: Request) {
  const q = Object.assign({}, req.query, req.body);
  const host = String(q.host ?? '').trim();
  const region = String(q.region ?? '').trim() || 'US/CA';
  const radius = String(q.radius ?? '').trim() || '50 mi';
  return { host, region, radius };
}

async function handleFind(req: Request, res: Response) {
  const { host, region, radius } = pickParams(req);
  if (!host) return sendBad(res, 'host is required');

  try {
    const item = await findOneBuyer(host, region, radius);
    const body: ApiOk<{ items: LeadItem[] }> = { ok: true, items: [item] };
    return res.json(body);
  } catch (e: any) {
    return sendBad(res, e?.message ?? 'internal error', 500);
  }
}

// Mount a full set of compat paths under several possible roots.
function mountCompat(root = '') {
  const base = (p: string) => (root ? `/${root.replace(/^\/+|\/+$/g, '')}${p}` : p);
  const paths = [
    '/leads/find-buyers',
    '/buyers/find-buyers',
    '/find-buyers',
    '/leads/find',
    '/buyers/find',
    '/find',
    '/leads/find-one',
    '/buyers/find-one',
    '/find-one',
  ];

  for (const p of paths) {
    app.get(base(p), handleFind);
    reg('GET', base(p));
    app.post(base(p), handleFind);
    reg('POST', base(p));
  }

  // Optional tiny index showing it's alive at this root
  app.get(base('/'), (_req, res) => res.json({ ok: true, root: root || '(root)' }));
  reg('GET', base('/'));
}

mountCompat('');
mountCompat('api');
mountCompat('api/v1');
mountCompat('v1');

// ---------- Warm/Hot list + locking ----------

// List current "warm" leads (what the panel shows)
app.get('/api/leads/warm', (_req, res) => {
  const b = buckets();
  // newest first
  const items = b.warm
    .slice()
    .sort((a, b) => b.created.localeCompare(a.created))
    .map(toLeadItem);

  const body: ApiOk<{ items: LeadItem[] }> = { ok: true, items };
  res.json(body);
});
reg('GET', '/api/leads/warm');

// Mark a host as hot/warm/cold (the Lock buttons)
app.post('/api/leads/lock', (req, res) => {
  const host = toHost(req.body?.host || req.query?.host);
  const temp: Temp = (String(req.body?.temp || req.query?.temp || '').toLowerCase() as Temp) || 'warm';
  if (!host) return sendBad(res, 'host is required');

  const updated = replaceHotWarm(host, temp);
  const body: ApiOk<{ item: LeadItem }> = { ok: true, item: toLeadItem(updated) };
  res.json(body);
});
reg('POST', '/api/leads/lock');

// ---------- Deeper results: live sweep of Zie619 (GitHub) ----------

async function sweepZie619() {
  const GH = process.env.GH_PAT_PUBLIC?.trim();
  const headers: Record<string, string> = {
    'user-agent': 'buyers-api',
    accept: 'application/vnd.github+json',
  };
  if (GH) headers.authorization = `Bearer ${GH}`;

  const resp = await fetch(
    'https://api.github.com/users/zie619/repos?sort=updated&per_page=100',
    { headers }
  );

  let rows: any;
  try {
    rows = await resp.json();
  } catch {
    rows = null;
  }

  // Handle rate limit / errors explicitly so we know what happened.
  if (!Array.isArray(rows)) {
    const msg = rows?.message || `unexpected response (${resp.status})`;
    return { saved: 0, hosts: [] as string[], note: `github: ${msg}` };
  }

  const now = new Date().toISOString();

  const domainFromText = (txt?: string) => {
    if (!txt) return;
    const m = String(txt).match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
    if (!m) return;
    const h = m[1].toLowerCase();
    return h.endsWith('github.com') ? undefined : h;
  };

  const hosts = new Set<string>();
  for (const r of rows) {
    const h =
      toHost(r?.homepage) ||
      domainFromText(r?.description) ||
      (r?.owner?.login ? `${String(r.owner.login).toLowerCase()}.github.io` : undefined);
    if (h) hosts.add(h);
  }

  let saved = 0;
  for (const h of hosts) {
    saveByHost(h, {
      title: `Repo ${h} — possible buyer @ ${h}`,
      platform: 'web',
      created: now,
      temperature: 'warm',
      why: '(from GitHub live sweep)',
      saved: true,
    });
    saved++;
  }

  return { saved, hosts: Array.from(hosts) };
}

// POST /api/leads/deepen  => run sweeps and stash into warm bucket
app.post('/api/leads/deepen', async (_req, res) => {
  try {
    const z = await sweepZie619();
    const body: ApiOk<{ saved: number; hosts: string[]; note?: string }> = {
      ok: true,
      saved: z.saved,
      hosts: z.hosts,
      ...(z.note ? { note: z.note } : {}),
    };
    res.json(body);
  } catch (e: any) {
    return sendBad(res, e?.message ?? 'deepen failed', 500);
  }
});
reg('POST', '/api/leads/deepen');

// ---------- Open ingest endpoint (GitHub Actions posts here) ----------
// Accepts either a single object or { items: [ ... ] }
app.post('/api/ingest/github', (req, res) => {
  const now = new Date().toISOString();

  const coerceArray = (v: any) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.items)) return v.items;
    if (v && typeof v === 'object') return [v];
    return [];
  };

  const items = coerceArray(req.body);
  let saved = 0;
  const savedHosts: string[] = [];

  for (const it of items) {
    const host =
      toHost(it?.homepage) ||
      toHost(it?.website) ||
      toHost(it?.url) ||
      toHost(it?.repo_home) ||
      undefined;

    if (!host) continue;

    saveByHost(host, {
      title:
        it?.title ||
        (it?.name ? `Repo ${it.name} — possible buyer @ ${host}` : `Possible buyer @ ${host}`),
      platform: it?.platform || 'web',
      created: it?.created || now,
      temperature: (String(it?.temp || 'warm').toLowerCase() as Temp) || 'warm',
      why:
        it?.why ||
        it?.whyText ||
        (it?.owner ? `(from GitHub mirror: ${it.owner}/${it?.name || ''})` : '(from GitHub mirror)'),
      saved: true,
    });

    saved++;
    savedHosts.push(host);
  }

  const body: ApiOk<{ saved: number; hosts: string[] }> = { ok: true, saved, hosts: savedHosts };
  res.json(body);
});
reg('POST', '/api/ingest/github');

// ---------- Misc: watch/competitors (data is present if you need it) ----------
app.get('/api/leads/watchers', (req, res) => {
  const host = toHost((req.query.host as string) || '');
  if (!host) return sendBad(res, 'host is required');
  const w = watchers(host);
  const body: ApiOk<typeof w> = { ok: true, ...w };
  res.json(body);
});
reg('GET', '/api/leads/watchers');

// ---------- Start ----------
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`buyers-api listening on :${PORT}`);
});