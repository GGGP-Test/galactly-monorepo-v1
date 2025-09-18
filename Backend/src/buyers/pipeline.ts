// src/buyers/pipeline.ts
// Combines Google News RSS and user-supplied RSS feeds (ports/airports/regional biz).
// Tokenless, small memory footprint, with packaging-relevance scoring and enterprise down-weighting.

export type PipelineOpts = {
  region?: string;            // 'us' | 'ca' | 'usca' (used only for keyword bias)
  radiusMi?: number;          // not applied in RSS, but kept for future geo
  excludeEnterprise?: boolean;
  hotThreshold?: number;      // default 0.65
  maxPerSource?: number;      // default 25
};

export type Candidate = {
  domain?: string;
  company?: string;
  name?: string;
  region?: string;
  score: number;
  temperature: 'hot' | 'warm';
  source: string;
  evidence: Array<{ detail: { title: string; url?: string; date?: string }; topic?: string }>;
};

const BIG_BRANDS = [
  'amazon', 'walmart', 'target', 'costco', 'fedex', 'ups', 'home depot', 'lowe\'s',
  'apple', 'microsoft', 'google', 'alphabet', 'meta', 'tesla', 'pepsico', 'coca-cola',
  'procter & gamble', 'p&g', 'nike', 'adidas', 'samsung', 'dhl', 'maersk'
];

const NEWS_KEYWORDS = [
  'warehouse', 'distribution center', 'fulfillment center', 'dc', 'cold storage',
  'logistics center', 'facility', 'plant', 'manufacturing site', 'packaging facility'
];

const PACKAGING_TERMS = [
  'packaging', 'carton', 'corrugated', 'box', 'label', 'stretch film', 'shrink film',
  'pallet', 'void fill', 'molded pulp', 'foam', 'pouch', 'rollstock', 'laminate'
];

function nowIso() { return new Date().toISOString(); }

function isEnterprise(title: string): boolean {
  const t = title.toLowerCase();
  return BIG_BRANDS.some(b => t.includes(b));
}

function packagingRelevance(h: string): number {
  const t = h.toLowerCase();
  let s = 0;
  if (NEWS_KEYWORDS.some(k => t.includes(k))) s += 0.4;
  if (PACKAGING_TERMS.some(k => t.includes(k))) s += 0.25;
  if (/(opens|opening|launch|expand|expansion|invest)/i.test(t)) s += 0.25;
  if (/(hiring|jobs|recruit)/i.test(t)) s += 0.1; // small bump only
  return Math.min(1, s);
}

/** —— RSS helpers —— **/

async function fetchXml(url: string, timeoutMs = 6000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return '';
    return await r.text();
  } catch { return ''; } finally { clearTimeout(t); }
}

function extractLinksFromGoogleDesc(desc: string): string | undefined {
  // Google News often puts a <a href="real-url"> inside description; try to pull it.
  const m = desc.match(/href=\"(https?:[^"]+)\"/i);
  return m?.[1];
}

type RssItem = { title: string; link?: string; pubDate?: string; description?: string };

function parseRss(xml: string, max = 50): RssItem[] {
  if (!xml) return [];
  const items: RssItem[] = [];
  const parts = xml.split(/<item>/gi).slice(1);
  for (let i = 0; i < Math.min(max, parts.length); i++) {
    const block = parts[i];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link  = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]  || '').trim();
    const pub   = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '').trim();
    const desc  = (block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (title) items.push({ title, link, pubDate: pub, description: desc });
  }
  return items;
}

/** —— Sources —— **/

async function googleNewsFeed(region?: string): Promise<Candidate[]> {
  // Focus on warehouse/DC/opening signals; Google News RSS query.
  const q = encodeURIComponent('(warehouse OR "distribution center" OR "cold storage") (opens OR opening OR expansion OR invest OR facility)');
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchXml(url);
  const items = parseRss(xml, 50);

  const out: Candidate[] = [];
  for (const it of items) {
    const title = it.title || '';
    let link = it.link || extractLinksFromGoogleDesc(it.description || '') || it.link || '';
    const score = packagingRelevance(title);
    if (score < 0.35) continue; // cut early

    const temp: 'hot' | 'warm' = score >= 0.65 ? 'hot' : 'warm';
    out.push({
      domain: link ? new URL(link).hostname.replace(/^www\./, '') : undefined,
      company: undefined,
      name: undefined,
      region,
      score,
      temperature: temp,
      source: 'google-news',
      evidence: [{ detail: { title, url: link, date: it.pubDate || nowIso() }, topic: 'News (Google RSS)' }]
    });
  }
  return out;
}

async function customRssFeeds(): Promise<Candidate[]> {
  const env = (process.env.BUYERS_RSS_FEEDS || '').trim();
  if (!env) return [];
  const feeds = env.split(',').map(s => s.trim()).filter(Boolean);
  const out: Candidate[] = [];

  // Fetch sequentially to avoid bursts on free dynos
  for (const feed of feeds) {
    const xml = await fetchXml(feed);
    const items = parseRss(xml, 50);
    for (const it of items) {
      const title = it.title || '';
      const link = it.link || extractLinksFromGoogleDesc(it.description || '') || '';
      const score = packagingRelevance(title);
      if (score < 0.35) continue;

      out.push({
        domain: link ? new URL(link).hostname.replace(/^www\./, '') : undefined,
        score,
        temperature: score >= 0.65 ? 'hot' : 'warm',
        source: `rss:${new URL(feed).hostname}`,
        evidence: [{ detail: { title, url: link, date: it.pubDate || nowIso() }, topic: 'News (RSS)' }]
      });
    }
  }
  return out;
}

/** —— Merge, score, filter —— **/

function dedupeByTitle(items: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const res: Candidate[] = [];
  for (const c of items) {
    const k = (c.evidence?.[0]?.detail?.title || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    res.push(c);
  }
  return res;
}

function applyEnterpriseRule(items: Candidate[], exclude: boolean): Candidate[] {
  if (!exclude) return items;
  return items
    .map(c => {
      const title = c.evidence?.[0]?.detail?.title || '';
      if (!title) return c;
      // strong down-weight on megacorps
      const penalty = isEnterprise(title) ? 0.5 : 0;
      const newScore = Math.max(0, c.score - penalty);
      return { ...c, score: newScore, temperature: newScore >= 0.65 ? 'hot' : 'warm' } as Candidate;
    })
    .filter(c => c.score >= 0.35); // prune if became too weak
}

export async function runPipeline(_discovery: any, opts: PipelineOpts): Promise<{ candidates: Candidate[] }> {
  const hotThreshold = typeof opts.hotThreshold === 'number' ? opts.hotThreshold! : (Number(process.env.HOT_THRESHOLD || '0.65') || 0.65);
  const maxPerSource = Number(process.env.MAX_ITEMS_PER_SOURCE || String(opts.maxPerSource || 25));

  const [gn, rss] = await Promise.all([
    googleNewsFeed(opts.region),
    customRssFeeds()
  ]);

  // Cap per source
  const cap = (arr: Candidate[]) => arr.slice(0, maxPerSource);
  let merged = dedupeByTitle([...cap(gn), ...cap(rss)]);

  // Enterprise rule
  const exclude = String(process.env.EXCLUDE_ENTERPRISE || (opts.excludeEnterprise ? 'true' : 'false')).toLowerCase() === 'true';
  merged = applyEnterpriseRule(merged, exclude);

  // Normalize temperature by hotThreshold
  merged = merged.map(c => ({ ...c, temperature: c.score >= hotThreshold ? 'hot' : 'warm' }));

  return { candidates: merged };
}