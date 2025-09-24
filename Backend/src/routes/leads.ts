// src/routes/leads.ts
import { Router, Request, Response } from 'express';
import {
  buckets,
  saveByHost,
  replaceHotWarm,
} from '../shared/memStore';
import { addMirroredHosts, listCandidates } from '../shared/candidatePool';

const r = Router();

/* -------------------- config -------------------- */
type Found = { host: string; url: string; title: string; why: string; temp: 'warm'|'hot' };

const TIMEOUT_MS = 4000;           // tighter for speed
const MAX_CONCURRENCY = 12;        // more parallelism
const MAX_TEST = 28;               // cap candidates per sweep
const EARLY_HITS = 3;              // return as soon as we have this many
const PATHS = [
  '/supplier-registration','/vendor-registration',
  '/supplier','/suppliers','/vendor','/vendors',
  '/supplier-portal','/vendor-portal',
  '/procurement','/purchasing','/sourcing',
  '/doing-business-with','/partners','/partner','/rfq','/rfi'
];

const INTENT = ['supplier','vendors','vendor','procurement','purchasing','sourcing','registration','portal','rfq','rfi'];
const PACK   = ['packaging','carton','cartons','corrugated','boxes','labels','pouch','pouches','mailers','folding carton','case pack','display'];

/* -------------------- helpers -------------------- */
function toUrl(host: string, path: string) {
  return `https://${host.replace(/^https?:\/\//,'').replace(/\/.*/,'')}${path}`;
}
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
function titleFrom(html: string) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return (m?.[1] || 'Supplier / Vendor Portal').trim().replace(/\s+/g,' ').slice(0, 160);
}
function score(html: string) {
  const h = html.toLowerCase();
  let i = 0, p = 0;
  for (const t of INTENT) if (h.includes(t)) i++;
  for (const t of PACK)   if (h.includes(t)) p++;
  return { intent: i, pack: p, total: i + p };
}
function uniq<T>(arr: T[]) { return Array.from(new Set(arr)); }

/* -------------------- supplier keywording -------------------- */
async function extractKeywordsFromSupplier(supplierHost: string): Promise<string[]> {
  const html = await fetchHtml(`https://${supplierHost}`);
  if (!html) return [];
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .toLowerCase();
  const keys = ['packaging','flexible','labels','carton','corrugated','display','fulfillment','mailers','pouch','sleeve','shrink','foam'];
  const hits = keys.filter(k => text.includes(k));
  return uniq(hits).slice(0, 3);
}

/* -------------------- probe a candidate buyer -------------------- */
async function probeBuyer(buyerHost: string, requirePack = true): Promise<Found|undefined> {
  for (const p of PATHS) {
    const url = toUrl(buyerHost, p);
    const html = await fetchHtml(url);
    if (!html) continue;
    const s = score(html);
    // Filter out generic vendor portals by requiring packaging hints unless disabled
    if ((s.intent >= 1 || s.total >= 2) && (!requirePack || s.pack >= 1)) {
      const title = titleFrom(html);
      const why = `vendor page ${p}${s.pack ? ' (+packaging hints)' : ''}`;
      return { host: buyerHost, url, title, why, temp: 'warm' };
    }
  }
  return;
}

/* -------------------- orchestrate a fast, early-return sweep -------------------- */
async function findBuyersFast(supplierHost: string, region: string): Promise<Found[]> {
  const kw = await extractKeywordsFromSupplier(supplierHost);
  // Pull from our candidate pool (mirrored + curated)
  let candidates = listCandidates(region, 64);

  // weak personalization: prefer domains that appear to align with keywords in their domain or known brand.
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
  let resolved = false;

  const done = () => {
    if (resolved) return;
    resolved = true;
    return out;
  };

  return await new Promise<Found[]>(resolve => {
    const watchdog = setTimeout(() => resolve(done() || out), Math.max(5000, TIMEOUT_MS + 1500));

    const next = () => {
      if ((out.length >= EARLY_HITS) || (i >= candidates.length && active === 0)) {
        clearTimeout(watchdog);
        return resolve(done() || out);
      }
      while (active < MAX_CONCURRENCY && i < candidates.length && out.length < EARLY_HITS) {
        const buyer = candidates[i++];
        active++;
        probeBuyer(buyer, true)
          .then(f => { if (f) out.push(f); })
          .finally(() => { active--; next(); });
      }
    };
    next();
  });
}

/* -------------------- list buckets -------------------- */
r.get(['/leads/warm','/warm'], (_req, res) => {
  const { warm } = buckets();
  return res.json({
    ok: true,
    items: warm.map(l => ({
      host: l.host, platform: l.platform || 'web', title: l.title || 'Buyer lead',
      created: l.created, temp: l.temperature, whyText: l.why || '',
    }))
  });
});
r.get(['/leads/hot','/hot'], (_req, res) => {
  const { hot } = buckets();
  return res.json({
    ok: true,
    items: hot.map(l => ({
      host: l.host, platform: l.platform || 'web', title: l.title || 'Buyer lead',
      created: l.created, temp: l.temperature, whyText: l.why || '',
    }))
  });
});

/* -------------------- lock (panel buttons) -------------------- */
r.post(['/leads/lock','/lock'], (req: Request, res: Response) => {
  const host = String(req.body?.host || req.query.host || '').trim().toLowerCase();
  const temp = String(req.body?.temp || req.query.temp || 'warm').toLowerCase() as any;
  if (!host) return res.status(400).json({ ok: false, error: 'host required' });
  const changed = replaceHotWarm(host, temp === 'hot' ? 'hot' : temp === 'cold' ? 'cold' : 'warm');
  return res.json({ ok: true, host: changed.host, temp: changed.temperature });
});

/* -------------------- real-time find -------------------- */
// GET /api/leads/find-buyers?host=supplier.com&region=US/CA
r.get(['/leads/find','/leads/find-buyers','/find','/find-buyers'], async (req: Request, res: Response) => {
  const supplierHost = String(req.query.host || '').trim().toLowerCase();
  const region = String(req.query.region || 'US/CA');
  if (!supplierHost) return res.status(400).json({ ok: false, error: 'host is required' });

  try {
    const found = await findBuyersFast(supplierHost, region);

    for (const f of found) {
      saveByHost(f.host, {
        title: f.title,
        platform: 'web',
        created: new Date().toISOString(),
        temperature: f.temp,
        why: `${f.why} — source: live`,
        saved: true,
      });
    }

    return res.json({ ok: true, items: found.map(f => ({
      host: f.host, platform: 'web', title: f.title,
      created: new Date().toISOString(), temp: f.temp, whyText: f.why,
    }))});
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'internal error' });
  }
});

/* -------------------- mirror ingestion endpoints -------------------- */
// POST /api/ingest/hosts { hosts: string[], source?: string }
r.post(['/ingest/hosts','/api/ingest/hosts'], (req: Request, res: Response) => {
  const hosts = Array.isArray(req.body?.hosts) ? req.body.hosts : [];
  const source = String(req.body?.source || 'mirror');
  addMirroredHosts(hosts, source);
  return res.json({ ok: true, added: hosts.length });
});

// Back-compat: if Actions send objects {homepage, owner, name,...}, accept them too.
r.post(['/ingest/github','/api/ingest/github'], (req: Request, res: Response) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const hosts: string[] = [];
  for (const it of items) {
    const h = String(it?.homepage || '').toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*/,'').replace(/^www\./,'');
    if (h && h.includes('.')) hosts.push(h);
  }
  if (hosts.length) addMirroredHosts(hosts, 'github');
  return res.json({ ok: true, added: hosts.length });
});

export default r;