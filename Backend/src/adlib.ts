// Backend/src/adlib.ts
// Finds recent advertisers (likely buyers) via Apify actors + your seed keywords.
// Zero extra deps. Node 20 global fetch OK.

import fs from 'fs';
import path from 'path';

export type VendorProfile = {
  industries?: string[];
  regions?: string[];   // e.g. ["US","CA","North America"]
  materials?: string[]; // not used here but kept for shape
  print?: string[];     // "
  moq?: number;         // "
};

export type AdHit = {
  source: string;       // 'meta' | 'google' | 'tiktok' | etc.
  domain: string;
  proofUrl: string;
  adCount?: number;
  lastSeen?: string;    // ISO
  pageName?: string;
};

const APIFY_TOKEN = process.env.APIFY_TOKEN || '';
const META_ACTOR  = process.env.APIFY_META_ADS_ACTOR_ID || '';    // e.g. "lucagruentzel/facebook-ads-library-scraper" (example, set your own)
const GOOGLE_ACTOR= process.env.APIFY_GOOGLE_ADS_ACTOR_ID || '';  // optional, set if you have one
const TIKTOK_ACTOR= process.env.APIFY_TIKTOK_ADS_ACTOR_ID || '';  // optional

const AD_KEYWORDS_FILE = process.env.AD_KEYWORDS_FILE || '/etc/secrets/ad_keywords.txt';
const MAX_RESULTS = Number(process.env.AD_MAX_RESULTS || 50);
const LOOKBACK_DAYS = Number(process.env.AD_LOOKBACK_DAYS || 14);

function readLines(p: string): string[] {
  try {
    const t = fs.readFileSync(p, 'utf8');
    return t.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  } catch { return []; }
}

function normalizeDomain(u: string): string {
  try {
    const raw = u.startsWith('http') ? u : `https://${u}`;
    const url = new URL(raw);
    let h = url.hostname.toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h;
  } catch {
    // fallback: strip path, protocol-ish
    return u.replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'').toLowerCase();
  }
}

function dedupeByDomain(hits: AdHit[]): AdHit[] {
  const m = new Map<string, AdHit>();
  for (const h of hits) {
    const d = normalizeDomain(h.domain);
    if (!d) continue;
    const prev = m.get(d);
    if (!prev) { m.set(d, { ...h, domain: d }); continue; }
    // keep the one with newer lastSeen or higher adCount
    const newer = (a?: string, b?: string) => (a && b) ? (new Date(a).getTime() >= new Date(b).getTime()) : (!!a && !b);
    if (newer(h.lastSeen, prev.lastSeen) || (Number(h.adCount||0) > Number(prev.adCount||0))) {
      m.set(d, { ...h, domain: d });
    }
  }
  return Array.from(m.values());
}

async function runActor(actorId: string, input: any): Promise<any[]> {
  if (!APIFY_TOKEN || !actorId) return [];
  try {
    // Start run
    const start = await fetch(`https://api.apify.com/v2/actors/${encodeURIComponent(actorId)}/runs`, {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ input })
    });
    if (!start.ok) return [];
    const run = await start.json() as any;
    const runId = run?.data?.id;
    if (!runId) return [];

    // Poll status (short, to stay free-tier friendly)
    const deadline = Date.now() + 45_000; // 45s cap
    let datasetId = run?.data?.defaultDatasetId;
    let status = run?.data?.status || 'RUNNING';
    while (!datasetId && Date.now() < deadline) {
      await new Promise(r=>setTimeout(r, 1500));
      const r2 = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`);
      if (!r2.ok) break;
      const j = await r2.json() as any;
      status = j?.data?.status;
      datasetId = j?.data?.defaultDatasetId || datasetId;
      if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') break;
    }

    if (!datasetId) return [];
    const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json`);
    if (!itemsRes.ok) return [];
    const items = await itemsRes.json();
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function buildQueries(v: VendorProfile, kwFromFile: string[]): string[] {
  const baseKw = kwFromFile.length ? kwFromFile : [
    'custom packaging', 'corrugated boxes', 'folding cartons', 'labels', 'pouches'
  ];
  const inds = (v.industries||[]).slice(0,4);
  const reg  = (v.regions||[]).slice(0,3);

  // Compose short query strings like: "snack brand packaging", "supplements boxes", etc.
  const out = new Set<string>();
  if (inds.length) {
    for (const i of inds) for (const k of baseKw) out.add(`${i} ${k}`);
  } else {
    for (const k of baseKw) out.add(k);
  }
  // Region hints appended (loose)
  if (reg.length) {
    const rSfx = reg.join(' OR ');
    for (const q of Array.from(out)) { out.delete(q); out.add(`${q} (${rSfx})`); }
  }
  return Array.from(out).slice(0, 12);
}

function toCountryCodes(regions?: string[]): string[] | undefined {
  if (!regions || !regions.length) return undefined;
  const map: Record<string,string> = { US:'US', USA:'US', 'United States':'US', CA:'CA', Canada:'CA', 'North America':'US' };
  const codes = Array.from(new Set(regions.map(r=>map[r] || '').filter(Boolean)));
  return codes.length ? codes : undefined;
}

function mapMetaItems(items: any[]): AdHit[] {
  // Actor outputs vary. We try common fields: pageUrl, pageName, website, adCount, lastSeen, transparencyUrl
  const hits: AdHit[] = [];
  for (const it of items||[]) {
    const url = it.website || it.pageUrl || it.transparencyUrl || it.url || '';
    if (!url) continue;
    hits.push({
      source: 'meta',
      domain: normalizeDomain(url),
      proofUrl: (it.transparencyUrl || it.pageUrl || url),
      adCount: Number(it.adCount || it.adsCount || 0),
      lastSeen: it.lastSeen || it.updatedAt || it.scrapedAt || null,
      pageName: it.pageName || it.name || undefined
    });
  }
  return hits;
}

function mapGenericItems(items: any[], source: string): AdHit[] {
  const hits: AdHit[] = [];
  for (const it of items||[]) {
    const url = it.website || it.landingPage || it.pageUrl || it.url || '';
    if (!url) continue;
    hits.push({
      source,
      domain: normalizeDomain(url),
      proofUrl: it.pageUrl || it.proofUrl || url,
      adCount: Number(it.adCount || 0),
      lastSeen: it.lastSeen || it.updatedAt || null,
      pageName: it.pageName || it.name || undefined
    });
  }
  return hits;
}

export async function findAdvertisers(vendor: VendorProfile): Promise<AdHit[]> {
  const keywords = readLines(AD_KEYWORDS_FILE);
  const queries = buildQueries(vendor, keywords);
  const countries = toCountryCodes(vendor.regions);
  const sinceDays = LOOKBACK_DAYS;

  const all: AdHit[] = [];

  // META (Facebook/Instagram) — strongest free signal
  if (APIFY_TOKEN && META_ACTOR) {
    const input = {
      queries,
      sinceDays,
      countries,          // actor-dependent; many accept "countries" or "country"
      maxItems: 200,
      // vendor filters can be passed via "search" or "keywords" — actors differ; this is generic
      keywords
    };
    const items = await runActor(META_ACTOR, input);
    all.push(...mapMetaItems(items));
  }

  // Google Ads Transparency (optional; actor differs — generic map)
  if (APIFY_TOKEN && GOOGLE_ACTOR) {
    const input = { queries, sinceDays, countries, maxItems: 200 };
    const items = await runActor(GOOGLE_ACTOR, input);
    all.push(...mapGenericItems(items, 'google'));
  }

  // TikTok (optional)
  if (APIFY_TOKEN && TIKTOK_ACTOR) {
    const input = { queries, sinceDays, countries, maxItems: 200 };
    const items = await runActor(TIKTOK_ACTOR, input);
    all.push(...mapGenericItems(items, 'tiktok'));
  }

  // Deduplicate & trim
  const deduped = dedupeByDomain(all)
    .filter(h => h.domain.endsWith('.com') || h.domain.endsWith('.ca'))
    .slice(0, MAX_RESULTS);

  return deduped;
}

// Quick manual test helper (optional)
// npx tsx src/adlib.ts
if (require.main === module) {
  (async () => {
    const sample: VendorProfile = { industries:['snacks','supplements'], regions:['US','CA'] };
    const res = await findAdvertisers(sample);
    console.log(JSON.stringify(res.slice(0,10), null, 2));
  })();
}
