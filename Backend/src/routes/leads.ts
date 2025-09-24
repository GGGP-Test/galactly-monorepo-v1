// src/routes/leads.ts
import { Router, Request, Response } from 'express';
import { q } from '../shared/db';
import { addMirroredHosts, listCandidates } from '../shared/candidatePool';
import { saveByHost, buckets, replaceHotWarm } from '../shared/memStore';

const r = Router();

/* ---------- knobs ---------- */
type Found = { host: string; url: string; title: string; why: string; temp: 'warm'|'hot'; score: number };

const TIMEOUT_MS = 4000;
const MAX_CONCURRENCY = 12;
const MAX_TEST = 28;
const EARLY_HITS = 3;

const PATHS_PRIMARY = [
  '/supplier-registration','/vendor-registration',
  '/supplier','/suppliers','/vendor','/vendors',
  '/supplier-portal','/vendor-portal',
  '/procurement','/purchasing','/sourcing',
  '/doing-business-with','/partners','/partner','/rfq','/rfi'
];
const PATHS_SECONDARY = [
  '/business','/company/suppliers','/about/suppliers','/supply-chain','/compliance/suppliers'
];

const INTENT = ['supplier','suppliers','vendor','vendors','procurement','purchasing','sourcing','registration','portal','rfq','rfi'];
const PACK   = ['packaging','carton','corrugated','boxes','labels','pouch','mailers','display','case pack','folding carton','tray','sleeve'];

/* ---------- utils ---------- */
const toUrl = (host: string, path: string) => `https://${host.replace(/^https?:\/\//,'').replace(/\/.*/,'')}${path}`;

async function fetchHtml(url: string): Promise<string|undefined> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal } as any);
    if (!r.ok) return;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return;
    return (await r.text()).slice(0, 200_000);
  } catch { return; } finally { clearTimeout(t); }
}
const titleFrom = (html: string) => (html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || 'Supplier / Vendor Portal')
  .trim().replace(/\s+/g,' ').slice(0,160);

function score(html: string) {
  const h = html.toLowerCase();
  let i=0, p=0;
  for (const t of INTENT) if (h.includes(t)) i++;
  for (const t of PACK)   if (h.includes(t)) p++;
  return { intent: i, pack: p, total: i+p };
}

async function extractSupplierKeywords(supplierHost: string): Promise<string[]> {
  const html = await fetchHtml(`https://${supplierHost}`);
  if (!html) return [];
  const text = html.replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').toLowerCase();
  const keys = ['packaging','flexible','labels','carton','corrugated','display','fulfillment','mailers','pouch','sleeve','shrink','foam','thermoform','bottle','cap','tube'];
  const out = keys.filter(k => text.includes(k));
  return Array.from(new Set(out)).slice(0,3);
}

/* ---------- probe logic ---------- */
async function probeBuyer(buyerHost: string, requirePack = true, secondary = false): Promise<Found|undefined> {
  const PATHS = secondary ? PATHS_SECONDARY : PATHS_PRIMARY;
  for (const p of PATHS) {
    const url = toUrl(buyerHost, p);
    const html = await fetchHtml(url);
    if (!html) continue;
    const s = score(html);
    if ((s.intent >= 1 || s.total >= 2) && (!requirePack || s.pack >= 1)) {
      const title = titleFrom(html);
      const why = `vendor page ${p}${s.pack ? ' (+packaging hints)' : ''}`;
      return { host: buyerHost, url, title, why, temp: 'warm', score: s.total + (s.pack ? 2 : 0) };
    }
  }
  return;
}

async function findBuyersFast(supplierHost: string, region: string): Promise<Found[]> {
  const kw = await extractSupplierKeywords(supplierHost);
  let candidates = listCandidates(region, 64);

  if (kw.length) {
    candidates = candidates.sort((a,b) => {
      const sa = kw.some(k => a.includes(k)) ? 1 : 0;
      const sb = kw.some(k => b.includes(k)) ? 1 : 0;
      return sb - sa;
    });
  }
  candidates = candidates.slice(0, MAX_TEST);

  const out: Found[] = [];
  let i = 0, active = 0;
  return await new Promise<Found[]>(resolve => {
    const watchdog = setTimeout(()=>resolve(out), Math.max(5000, TIMEOUT_MS+1500));
    const next = () => {
      if (out.length >= EARLY_HITS || (i >= candidates.length && active === 0)) {
        clearTimeout(watchdog); return resolve(out.sort((a,b)=>b.score-a.score));
      }
      while (active < MAX_CONCURRENCY && i < candidates.length && out.length < EARLY_HITS) {
        const host = candidates[i++]; active++;
        probeBuyer(host, true, false)
          .then(f => { if (f) out.push(f); })
          .finally(()=>{ active--; next(); });
      }
    };
    next();
  });
}

/* ---------- persistence helpers ---------- */
async function persistLead(supplier: string, f: Found) {
  // keep UI instant via mem, also write to DB
  saveByHost(f.host, {
    title: f.title, platform:'web', created: new Date().toISOString(),
    temperature: f.temp, why: `${f.why} — source: live`, saved: true
  });
  await q(
    `insert into buyer_leads (supplier_host,buyer_host,url,title,why,platform,temperature,score,source)
     values ($1,$2,$3,$4,$5,'web',$6,$7,'live')
     on conflict (supplier_host,buyer_host,url) do update
       set title=excluded.title, why=excluded.why, temperature=excluded.temperature, score=excluded.score`,
    [supplier, f.host, f.url, f.title, f.why, f.temp, f.score]
  );
}

/* ---------- endpoints ---------- */

// live sweep
r.get(['/leads/find','/leads/find-buyers','/find','/find-buyers'], async (req: Request, res: Response) => {
  const supplierHost = String(req.query.host || '').trim().toLowerCase();
  const region = String(req.query.region || 'US/CA');
  if (!supplierHost) return res.status(400).json({ ok:false, error:'host is required' });

  try {
    const found = await findBuyersFast(supplierHost, region);
    for (const f of found) await persistLead(supplierHost, f);
    return res.json({ ok:true, items: found.map(f => ({
      host:f.host, platform:'web', title:f.title,
      created:new Date().toISOString(), temp:f.temp, whyText:f.why
    }))});
  } catch (e:any) {
    return res.status(500).json({ ok:false, error: e?.message || 'internal error' });
  }
});

// deepen = broader paths, allow weaker packaging hints, and keep the best
r.post(['/leads/deepen','/deepen'], async (req: Request, res: Response) => {
  const supplierHost = String(req.body?.host || req.query.host || '').trim().toLowerCase();
  const region = String(req.body?.region || req.query.region || 'US/CA');
  if (!supplierHost) return res.status(400).json({ ok:false, error:'host required' });

  // widen search on same candidate set (secondary paths, pack optional)
  let candidates = listCandidates(region, 80).slice(0, 40);
  const out: Found[] = [];
  await Promise.all(candidates.map(async h => {
    const f = await probeBuyer(h, false, true);
    if (f) out.push({ ...f, temp: 'warm', score: f.score - 1 });
  }));
  out.sort((a,b)=>b.score-a.score).slice(0, 10);
  for (const f of out) await persistLead(supplierHost, f);

  return res.json({ ok:true, added: out.length });
});

// warm/hot lists (prefer DB if present)
r.get(['/leads/warm','/warm'], async (_req, res) => {
  const db = await q<any>(`select buyer_host as host, title, why, temperature, created_at
                           from buyer_leads where temperature='warm'
                           order by created_at desc limit 200`);
  if (db.rowCount && db.rowCount > 0) {
    return res.json({ ok:true, items: db.rows.map(r => ({
      host:r.host, platform:'web', title:r.title || 'Buyer lead',
      created:r.created_at, temp:'warm', whyText:r.why || ''
    }))});
  }
  const { warm } = buckets();
  return res.json({ ok:true, items: warm.map(l => ({
    host:l.host, platform:l.platform || 'web', title:l.title || 'Buyer lead',
    created:l.created, temp:l.temperature, whyText:l.why || ''
  }))});
});

r.get(['/leads/hot','/hot'], async (_req, res) => {
  const db = await q<any>(`select buyer_host as host, title, why, temperature, created_at
                           from buyer_leads where temperature='hot'
                           order by created_at desc limit 200`);
  if (db.rowCount && db.rowCount > 0) {
    return res.json({ ok:true, items: db.rows.map(r => ({
      host:r.host, platform:'web', title:r.title || 'Buyer lead',
      created:r.created_at, temp:'hot', whyText:r.why || ''
    }))});
  }
  const { hot } = buckets();
  return res.json({ ok:true, items: hot.map(l => ({
    host:l.host, platform:l.platform || 'web', title:l.title || 'Buyer lead',
    created:l.created, temp:l.temperature, whyText:l.why || ''
  }))});
});

// lock button
r.post(['/leads/lock','/lock'], (req: Request, res: Response) => {
  const host = String(req.body?.host || req.query.host || '').trim().toLowerCase();
  const temp = String(req.body?.temp || req.query.temp || 'warm').toLowerCase();
  if (!host) return res.status(400).json({ ok:false, error:'host required' });
  const t = (temp === 'hot' ? 'hot' : temp === 'cold' ? 'cold' : 'warm') as any;
  replaceHotWarm(host, t);
  return res.json({ ok:true, host, temp:t });
});

// ingestion from Actions
r.post(['/ingest/hosts','/api/ingest/hosts'], async (req: Request, res: Response) => {
  const hosts = Array.isArray(req.body?.hosts) ? req.body.hosts : [];
  const source = String(req.body?.source || 'mirror');
  addMirroredHosts(hosts, source);
  // also persist into candidate_hosts for later analysis
  for (const h of hosts) await q(
    `insert into candidate_hosts (host, seen_at, source)
     values ($1, now(), $2)
     on conflict (host) do update set seen_at=excluded.seen_at, source=excluded.source`,
    [h, source]
  );
  res.json({ ok:true, added: hosts.length });
});

r.post(['/ingest/github','/api/ingest/github'], async (req: Request, res: Response) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const hosts: string[] = [];
  for (const it of items) {
    const h = String(it?.homepage || '').toLowerCase()
      .replace(/^https?:\/\//,'').replace(/\/.*/,'').replace(/^www\./,'');
    if (h && h.includes('.')) hosts.push(h);
  }
  if (hosts.length) addMirroredHosts(hosts, 'github');
  for (const h of hosts) await q(
    `insert into candidate_hosts (host, seen_at, source)
     values ($1, now(), 'github')
     on conflict (host) do update set seen_at=excluded.seen_at, source='github'`,
     [h]
  );
  res.json({ ok:true, added: hosts.length });
});

export default r;