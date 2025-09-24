// src/index.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import {
  ensureLeadForHost,
  replaceHotWarm,
  buckets,
  saveByHost,
  watchers as getWatchers,
  type Temp,
} from './shared/memStore';

// ---------- setup ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

type ApiOk<T = any> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

function bad(res: Response, error: string, code = 400) {
  const body: ApiErr = { ok: false, error };
  return res.status(code).json(body);
}

function toHost(input?: string): string | undefined {
  if (!input) return;
  try {
    const s = input.trim();
    const u = s.includes('://') ? new URL(s) : new URL('https://' + s);
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return h.includes('.') ? h : undefined;
  } catch {
    // maybe it's already a host like "acme.com"
    const h = String(input).toLowerCase().replace(/^www\./, '');
    return h.includes('.') ? h : undefined;
  }
}

// ---------- health & routes index ----------
app.get(['/','/health','/healthz'], (_req, res) => res.json({ ok: true }));

app.get('/routes', (_req, res) => {
  res.json({
    ok: true,
    routes: [
      'GET  /api/leads/warm',
      'GET  /api/leads/hot',
      'POST /api/leads/lock',
      'POST /api/leads/deepen',
      'POST /api/ingest/github',
      'GET  /api/ingest/zie619/now',
    ],
  });
});

// ---------- panel list endpoints ----------
app.get('/api/leads/warm', (_req, res) => {
  const b = buckets();
  const items = b.warm.map(l => ({
    host: l.host,
    platform: l.platform ?? 'web',
    title: l.title ?? `Possible buyer @ ${l.host}`,
    created: l.created,
    temp: 'warm',
    whyText: l.why ?? 'saved warm',
  }));
  const body: ApiOk<{ items: any[] }> = { ok: true, items };
  res.json(body);
});

app.get('/api/leads/hot', (_req, res) => {
  const b = buckets();
  const items = b.hot.map(l => ({
    host: l.host,
    platform: l.platform ?? 'web',
    title: l.title ?? `Hot buyer @ ${l.host}`,
    created: l.created,
    temp: 'hot',
    whyText: l.why ?? 'locked hot',
  }));
  const body: ApiOk<{ items: any[] }> = { ok: true, items };
  res.json(body);
});

// ---------- panel actions ----------
app.post('/api/leads/lock', (req, res) => {
  const host = String(req.body?.host || '').trim();
  const as: Temp = (req.body?.temp || 'warm') as Temp;
  if (!host) return bad(res, 'host is required');
  const saved = replaceHotWarm(host, as);
  const { watchers, competitors } = getWatchers(host);
  const body: ApiOk = {
    ok: true,
    host: saved.host,
    temp: saved.temperature,
    watchers,
    competitors,
  };
  res.json(body);
});

// "Deeper results" → do a live sweep of Zie619 right now and stash results
app.post('/api/leads/deepen', async (_req, res) => {
  try {
    const { saved } = await sweepZie619();
    res.json(<ApiOk>{ ok: true, saved, why: 'live sweep' });
  } catch (e: any) {
    return bad(res, e?.message || 'deepen failed', 500);
  }
});

// ---------- ingest from GitHub actions (more tolerant payloads) ----------
// Accepts any of:
//   • {items:[{homepage?,owner?,name?,description?,topics?,temp?}]}
//   • {hosts:["acme.com","contoso.com", ...]}
//   • ["acme.com","contoso.com"]
app.post('/api/ingest/github', (req, res) => {
  const now = new Date().toISOString();
  let hosts: string[] = [];

  if (Array.isArray(req.body)) {
    hosts = req.body;
  } else if (Array.isArray(req.body?.hosts)) {
    hosts = req.body.hosts;
  } else if (Array.isArray(req.body?.items)) {
    hosts = req.body.items
      .map((it: any) => toHost(it.homepage) || toHost(it.owner?.login + '.github.io'))
      .filter(Boolean) as string[];
  }

  const uniq = Array.from(new Set(hosts.map(h => toHost(h)).filter(Boolean))) as string[];

  for (const h of uniq) {
    saveByHost(h, {
      title: `Repo mirror — possible buyer @ ${h}`,
      platform: 'web',
      created: now,
      temperature: 'warm',
      why: '(from GitHub mirror)',
      saved: true,
    });
  }

  res.json(<ApiOk>{ ok: true, saved: uniq.length, hosts: uniq });
});

// optional manual trigger if you want to call it directly
app.get('/api/ingest/zie619/now', async (_req, res) => {
  try {
    const out = await sweepZie619();
    res.json(<ApiOk>{ ok: true, ...out });
  } catch (e: any) {
    return bad(res, e?.message || 'live ingest failed', 500);
  }
});

// ---------- live Zie619 sweep (fast; no auth) ----------
async function sweepZie619() {
  const rows = await fetch(
    'https://api.github.com/users/zie619/repos?sort=updated&per_page=100',
    { headers: { 'user-agent': 'buyers-api' } },
  ).then(r => r.json());

  const now = new Date().toISOString();
  let saved = 0;

  const hostFromRow = (r: any): string | undefined => {
    const byHome = toHost(r?.homepage);
    if (byHome) return byHome;

    const txt = String(r?.description || '');
    const m = txt.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
    const fromDesc = m?.[1]?.toLowerCase();
    if (fromDesc && !fromDesc.endsWith('github.com')) return fromDesc;

    if (r?.owner?.login) return `${String(r.owner.login).toLowerCase()}.github.io`;
  };

  const hosts = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const h = hostFromRow(r);
    if (!h) continue;
    hosts.add(h);
  }

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

// ---------- legacy compat so the panel stays happy ----------
async function findOneBuyer(host: string, region: string, radius: string) {
  return {
    host,
    platform: 'web',
    title: `Buyer lead for ${host}`,
    created: new Date().toISOString(),
    temp: 'warm',
    whyText: `Compat shim matched (${region}, ${radius})`,
  };
}

function pick(req: Request) {
  const q = Object.assign({}, req.query, req.body);
  const host = String(q.host ?? '').trim();
  const region = String(q.region ?? '').trim() || 'US/CA';
  const radius = String(q.radius ?? '').trim() || '50 mi';
  return { host, region, radius };
}

async function handleFind(req: Request, res: Response) {
  const { host, region, radius } = pick(req);
  if (!host) return bad(res, 'host is required');
  const item = await findOneBuyer(host, region, radius);
  res.json(<ApiOk>{ ok: true, items: [item] });
}

function mountCompat(root = '') {
  const base = (p: string) => (root ? `/${root.replace(/^\/+|\/+$/g,'')}${p}` : p);
  const paths = [
    '/leads/find-buyers','/buyers/find-buyers','/find-buyers',
    '/leads/find','/buyers/find','/find',
    '/leads/find-one','/buyers/find-one','/find-one',
  ];
  for (const p of paths) {
    app.get(base(p), handleFind);
    app.post(base(p), handleFind);
  }
  app.get(base('/'), (_req, res) => res.json({ ok: true, root: root || '(root)' }));
}
mountCompat(''); mountCompat('api'); mountCompat('api/v1'); mountCompat('v1');

// ---------- run ----------
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => console.log(`buyers-api listening on :${PORT}`));