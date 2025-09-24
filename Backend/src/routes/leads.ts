// src/routes/leads.ts
import { Router, Request, Response } from 'express';
import {
  buckets,
  saveByHost,
  replaceHotWarm,
} from '../shared/memStore';

const r = Router();

/* -------------------- config -------------------- */
type Found = { host: string; url: string; title: string; why: string; temp: 'warm'|'hot' };

const TIMEOUT_MS = 7000;
const MAX_CONCURRENCY = 6;
const MAX_SEARCH_RESULTS = 18;

const BUYER_SEEDS_USCA = [
  'walmart.com','target.com','costco.com','homedepot.com','lowes.com',
  'bestbuy.com','nike.com','adidas.com','pepsico.com','coca-cola.com','nestle.com',
  'unilever.com','kraftheinzcompany.com','pg.com','kimberly-clark.com','colgatepalmolive.com',
  '3m.com','johnsoncontrols.com','abbott.com','intel.com','apple.com','microsoft.com',
  'albertsons.com','heb.com','dollargeneral.com','dollartree.com'
];

const PATHS = [
  '/supplier-registration','/vendor-registration',
  '/supplier','/suppliers','/vendor','/vendors',
  '/supplier-portal','/vendor-portal',
  '/procurement','/purchasing','/sourcing',
  '/doing-business-with','/partners','/partner'
];

const INTENT = ['supplier','vendors','vendor','procurement','purchasing','sourcing','registration','portal','rfq','rfi'];
const PACK   = ['packaging','carton','cartons','corrugated','boxes','labels','pouch','pouches','mailers','folding carton'];

/* -------------------- tiny helpers -------------------- */
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
    return (await r.text()).slice(0, 250_000);
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
function hostFrom(urlLike?: string): string | undefined {
  if (!urlLike) return;
  try {
    const u = urlLike.includes('://') ? new URL(urlLike) : new URL(`https://${urlLike}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return; }
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
  // top 3 is enough to steer search
  return uniq(hits).slice(0, 3);
}

/* -------------------- discovery via Bing (optional) -------------------- */
async function bingSearch(query: string): Promise<string[]> {
  const key = process.env.BING_KEY || '';
  if (!key) return [];
  const params = new URLSearchParams({ q: query, count: String(Math.min(50, MAX_SEARCH_RESULTS)), mkt: 'en-US', responseFilter: 'Webpages' });
  const url = `https://api.bing.microsoft.com/v7.0/search?${params.toString()}`;
  const r = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } } as any);
  if (!r.ok) return [];
  const j: any = await r.json();
  const web = j?.webPages?.value || [];
  const hosts = web.map((it: any) => hostFrom(it?.url)).filter(Boolean) as string[];
  return uniq(hosts);
}

/* -------------------- probe a candidate buyer -------------------- */
async function probeBuyer(buyerHost: string): Promise<Found|undefined> {
  for (const p of PATHS) {
    const url = toUrl(buyerHost, p);
    const html = await fetchHtml(url);
    if (!html) continue;
    const s = score(html);
    // intent >=1 OR total >=2 keeps it fast but relevant
    if (s.intent >= 1 || s.total >= 2) {
      const title = titleFrom(html);
      const why = `vendor page ${p}${s.pack ? ' (+packaging hints)' : ''}`;
      return { host: buyerHost, url, title, why, temp: 'warm' };
    }
  }
  return;
}

/* -------------------- orchestrate a fast sweep -------------------- */
async function findBuyersFast(supplierHost: string, region: string): Promise<Found[]> {
  // 1) personalize queries from supplier site
  const kw = await extractKeywordsFromSupplier(supplierHost);
  const regionTag = region.split('/')[1] || 'CA';
  const queries: string[] = [];

  // vendor/registration queries with optional packaging keywords and CA/US hint
  const baseQ = `(supplier OR vendor) (registration OR portal OR procurement) ${['US','USA',regionTag].join(' OR ')}`;
  if (kw.length) {
    for (const k of kw) queries.push(`${baseQ} ${k}`);
  } else {
    queries.push(baseQ);
  }

  // 2) collect candidate hosts: Bing if key, else seeds
  let candidates: string[] = [];
  for (const q of queries) {
    const hs = await bingSearch(q);
    candidates.push(...hs);
  }
  if (!candidates.length) candidates = BUYER_SEEDS_USCA.slice(0);

  candidates = uniq(candidates).slice(0, MAX_SEARCH_RESULTS + BUYER_SEEDS_USCA.length);

  // 3) probe candidates quickly
  const out: Found[] = [];
  let i = 0, active = 0;
  return await new Promise<Found[]>(resolve => {
    const next = () => {
      if (i >= candidates.length && active === 0) return resolve(out);
      while (active < MAX_CONCURRENCY && i < candidates.length) {
        const buyer = candidates[i++];
        active++;
        probeBuyer(buyer).then(f => { if (f) out.push(f); }).finally(() => { active--; next(); });
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
// POST /api/leads/lock { host, temp: "warm"|"hot"|"cold" }
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

    // persist to warm so list/CSV shows them
    for (const f of found) {
      saveByHost(f.host, {
        title: f.title,
        platform: 'web',
        created: new Date().toISOString(),
        temperature: f.temp,
        why: f.why,
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

export default r;