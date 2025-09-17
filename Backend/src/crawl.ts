/* eslint-disable no-console */

/**
 * Lead discovery & scoring (warm/hot) without relying on supplier "customers" pages.
 * - Free sources first (GDELT + direct tech/pixel probes)
 * - Optional web search adapters (Serper, Tavily) if API keys are present
 * - Robust: times out & never throws up to the route layer; returns [] on hard failures
 *
 * Usage (expected from index.ts):
 *   const leads = await crawlBuyers({ supplierHost, country: 'US', radiusMi: 50, persona });
 */

type Temp = 'hot' | 'warm' | 'cold';

export interface Persona {
  offer?: string;                 // e.g., "corrugated boxes"
  solves?: string;                // plain-language benefit
  buyerTitles?: string[];         // who to talk to
  sectors?: string[];             // industry hints (e.g., "DTC retail", "3PL")
  notes?: string;                 // free-form
}

export interface CrawlInput {
  supplierHost: string;
  country?: 'US' | 'CA';          // UI has "US/CA"
  radiusMi?: number;              // UI has distance; currently informative only
  persona?: Persona;
}

export interface Candidate {
  id: string;                     // stable-ish hash
  host: string;
  url: string;
  title: string;                  // company or site title
  platform: string;               // Shopify | WooCommerce | BigCommerce | Static | Unknown
  temp: Temp;
  score: number;                  // raw score (for debugging/promotions)
  why: string[];                  // human-readable reasons shown in “Why”
  createdAt: string;              // ISO
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REQ_TIMEOUT_MS = 12_000;
const PER_HOST_TIMEOUT_MS = 8_000;

// ---- helpers ----

function nowIso() {
  return new Date().toISOString();
}

function hashId(s: string) {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(x).toString(36);
}

function toHost(s: string) {
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
    return u.host.replace(/^www\./, '');
  } catch {
    return s.replace(/^www\./, '');
  }
}

function cutoffDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

async function fetchText(url: string, timeout = REQ_TIMEOUT_MS): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJSON<T>(url: string, timeout = REQ_TIMEOUT_MS): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function uniq<T>(arr: T[], key: (v: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of arr) {
    const k = key(v);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

// ---- signals (free) ----

/**
 * Detect e-commerce tech & ad pixels directly from homepage.
 */
async function probeSiteSignals(site: string): Promise<{ platform: string; reasons: string[]; hasAdPixels: boolean }> {
  const url = /^https?:\/\//.test(site) ? site : `https://${site}`;
  const reasons: string[] = [];
  let platform = 'Unknown';
  let hasAdPixels = false;

  let html = '';
  try {
    html = await fetchText(url, PER_HOST_TIMEOUT_MS);
  } catch {
    // try with www
    try {
      const www = new URL(url);
      www.host = `www.${www.host.replace(/^www\./, '')}`;
      html = await fetchText(www.toString(), PER_HOST_TIMEOUT_MS);
    } catch {
      return { platform, reasons, hasAdPixels };
    }
  }

  const H = html.toLowerCase();

  // platform heuristics
  if (H.includes('cdn.shopify.com') || H.includes('x-shopify-stage') || /\/cart\.js/.test(H)) {
    platform = 'Shopify';
    reasons.push('Detected Shopify assets');
  } else if (H.includes('woocommerce') || H.includes('wp-json/wc') || H.includes('wp-content/plugins/woocommerce')) {
    platform = 'WooCommerce';
    reasons.push('Detected WooCommerce');
  } else if (H.includes('cdn.bigcommerce.com') || H.includes('bigcommerce')) {
    platform = 'BigCommerce';
    reasons.push('Detected BigCommerce');
  } else if (H.includes('magento') || H.includes('mage/cookies')) {
    platform = 'Magento';
    reasons.push('Detected Magento');
  } else if (H.includes('add_to_cart') || H.includes('checkout')) {
    platform = 'E-commerce';
    reasons.push('Generic e-commerce signals');
  } else {
    platform = 'Unknown';
  }

  // ad pixels / analytics (buying intent)
  if (H.includes('facebook.com/tr') || H.includes('fbq(')) {
    hasAdPixels = true;
    reasons.push('Facebook pixel present');
  }
  if (H.includes('gtag(') || H.includes('googletagmanager.com/gtm.js')) {
    hasAdPixels = true;
    reasons.push('Google Ads/Analytics present');
  }
  if (H.includes('snaptr(') || H.includes('sc-static.net')) {
    hasAdPixels = true;
    reasons.push('Snap pixel present');
  }
  if (H.includes('ttq(') || H.includes('tiktok')) {
    hasAdPixels = true;
    reasons.push('TikTok pixel present');
  }

  return { platform, reasons, hasAdPixels };
}

/**
 * GDELT free news probe: find orgs with packaging/fulfillment news in the last N days.
 * Docs: https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/
 */
async function gdeltNewsCandidates(
  keywords: string[],
  daysBack = 14,
  max = 40
): Promise<{ host: string; url: string; title: string; why: string[]; freshness: number }[]> {
  const q = encodeURIComponent(
    `(${keywords.join(' OR ')}) AND (packaging OR fulfillment OR warehouse OR "e-commerce" OR logistics OR launch)`
  );
  const span = `${daysBack}d`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&format=json&mode=artlist&timespan=${span}&maxrecords=${max}`;

  type Gdelt = { articles?: { url: string; title: string; seendate?: string }[] };
  let data: Gdelt;
  try {
    data = await fetchJSON<Gdelt>(url, REQ_TIMEOUT_MS);
  } catch {
    return [];
  }
  const arts = data.articles ?? [];
  const results: { host: string; url: string; title: string; why: string[]; freshness: number }[] = [];

  for (const a of arts) {
    const host = toHost(a.url);
    const title = a.title || host;
    if (!host) continue;

    const seen = a.seendate ? new Date(a.seendate) : new Date();
    const ageDays = Math.max(0, (Date.now() - seen.getTime()) / 86_400_000);

    const why = [`Recent news: ${title}`];
    results.push({ host, url: a.url, title, why, freshness: Math.max(0, 10 - ageDays) }); // fresher → higher
  }

  return uniq(results, (r) => r.host);
}

// ---- optional search adapters (run only if keys exist) ----

async function serperCompanySearch(query: string, country?: string) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [] as { host: string; url: string; title: string; why: string[] }[];

  const payload = {
    q: query + (country ? ` site:.${country.toLowerCase()}` : ''),
    gl: country?.toLowerCase() ?? 'us',
    num: 10
  };

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`serper ${res.status}`);
    const json = await res.json();
    const items: any[] = [...(json.organic ?? []), ...(json.news ?? [])];

    return items
      .map((it) => {
        const url = it.link || it.url;
        const host = url ? toHost(url) : '';
        return host
          ? {
              host,
              url,
              title: it.title || host,
              why: [`Search hit: ${it.title || host}`]
            }
          : null;
      })
      .filter(Boolean) as { host: string; url: string; title: string; why: string[] }[];
  } catch {
    return [];
  }
}

async function tavilySearch(query: string, country?: string) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [] as { host: string; url: string; title: string; why: string[] }[];

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: 8 })
    });
    if (!res.ok) throw new Error(`tavily ${res.status}`);
    const json = await res.json();
    const results: any[] = json.results ?? [];
    return results
      .map((r) => {
        const url = r.url;
        const host = url ? toHost(url) : '';
        return host
          ? { host, url, title: r.title || host, why: [`Discovery: ${r.title || host}`] }
          : null;
      })
      .filter(Boolean) as { host: string; url: string; title: string; why: string[] }[];
  } catch {
    return [];
  }
}

// ---- scoring ----

function scoreToTemp(score: number): Temp {
  if (score >= 6) return 'hot';
  if (score >= 3) return 'warm';
  return 'cold';
}

function baseKeywordsFromPersona(p?: Persona): string[] {
  const out = new Set<string>([
    'packaging',
    'carton',
    'right-size',
    'dim-weight',
    'fulfillment',
    '3pl',
    'e-commerce',
    'distribution center',
    'warehouse'
  ]);
  (p?.sectors ?? []).forEach((s) => out.add(s));
  if (p?.offer) out.add(p.offer);
  if (p?.solves) out.add(p.solves);
  return [...out].filter(Boolean);
}

function dedupeMerge<T extends { host: string }>(lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const x of list) {
      if (!map.has(x.host)) map.set(x.host, x);
    }
  }
  return [...map.values()];
}

// ---- main entry ----

export async function crawlBuyers(input: CrawlInput): Promise<Candidate[]> {
  const { supplierHost, country = 'US', radiusMi = 50, persona } = input;

  const supplier = toHost(supplierHost);

  // 1) Seed keywords informed by persona
  const keywords = baseKeywordsFromPersona(persona);

  // 2) Gather candidates from free + optional sources (in parallel)
  const tasks: Promise<{ host: string; url: string; title: string; why: string[]; freshness?: number }[]>[] = [
    gdeltNewsCandidates(keywords, 21, 60), // last 3 weeks
    serperCompanySearch(
      `${keywords.slice(0, 3).join(' ')} buyers OR vendor OR supplier OR brand OR "e-commerce"`,
      country
    ),
    tavilySearch(`${keywords.slice(0, 3).join(' ')} brand packaging "launch" OR "opens" OR "expands"`, country)
  ];

  let raw = [] as { host: string; url: string; title: string; why: string[]; freshness?: number }[];
  try {
    const settled = await Promise.all(tasks.map((p) => p.catch(() => [])));
    raw = dedupeMerge(settled);
  } catch {
    // swallow: continue with whatever we have
  }

  if (raw.length === 0) {
    // Still return empty list, not an error; UI can show "0 candidates".
    return [];
  }

  // 3) Probe each site for e-commerce and ad-pixel signals (throttled)
  const limit = pLimit(5);
  const probed = await Promise.all(
    raw.slice(0, 60).map((r) =>
      limit(async () => {
        const sig = await probeSiteSignals(r.host);
        return { ...r, ...sig };
      })
    )
  );

  // 4) Score
  const today = new Date();
  const hotCutoff = cutoffDays(10);

  const scored: Candidate[] = probed.map((p) => {
    let score = 0;
    const why = [...p.why];

    // E-commerce platform strength
    switch (p.platform) {
      case 'Shopify':
      case 'BigCommerce':
        score += 2;
        break;
      case 'WooCommerce':
      case 'Magento':
      case 'E-commerce':
        score += 1.5;
        break;
      default:
        break;
    }

    // Marketing activity (ad pixels)
    if (p.hasAdPixels) {
      score += 1.5;
      why.push('Active ad/analytics pixels → likely traffic & demand');
    }

    // Fresh news signal (from GDELT)
    if (p.freshness && p.freshness > 0) {
      score += Math.min(2, Math.max(0.5, p.freshness / 4)); // up to +2
      if (p.freshness > 1) why.push('Recent news mentions related to packaging/fulfillment');
    }

    // Country pre-filter (soft)
    if (country === 'US' || country === 'CA') {
      score += 0.5; // mild bump to keep in list
    }

    // Supplier proximity (radius is informative only here; geocoding comes later in n8n workflow)
    if (radiusMi >= 50) score += 0.25;

    const temp = scoreToTemp(score);

    return {
      id: hashId(`${p.host}|${supplier}`),
      host: p.host,
      url: p.url || `https://${p.host}`,
      title: p.title || p.host,
      platform: p.platform || 'Unknown',
      temp,
      score: Math.round(score * 100) / 100,
      why,
      createdAt: nowIso()
    };
  });

  // 5) Filter out the supplier itself & extremely weak matches
  const out = scored
    .filter((c) => c.host !== supplier)
    .filter((c) => c.score >= 2 || c.temp !== 'cold')
    .slice(0, 40);

  // Sorted: hot first, then warm, then by score desc
  out.sort((a, b) => {
    const t = (x: Temp) => (x === 'hot' ? 2 : x === 'warm' ? 1 : 0);
    if (t(b.temp) !== t(a.temp)) return t(b.temp) - t(a.temp);
    return b.score - a.score;
  });

  return out;
}

// default export for index.ts convenience
export default crawlBuyers;

// Simple Promise-limit (no external deps)
function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    if (queue.length) queue.shift()?.();
  };
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(
          (v) => {
            next();
            resolve(v);
          },
          (e) => {
            next();
            reject(e);
          }
        );
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}
