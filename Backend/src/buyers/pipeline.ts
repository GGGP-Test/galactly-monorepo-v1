// Buyers pipeline with resilient dual-RSS fallback (Google News + Bing News).
// Node 20 has global fetch; no extra deps.

type Discovery = {
  supplierDomain?: string;
  persona?: any;
  latents?: string[];
  archetypes?: string[];
};

type PipelineOpts = {
  region?: string;          // "us", "ca", or "usca"
  radiusMi?: number;
};

type Candidate = {
  domain?: string;
  website?: string;
  company?: string;
  name?: string;
  title?: string;
  score?: number;      // 0..1 – used by caller to mark hot/warm
  source?: string;     // adapter/source label
  evidence?: any[];    // lightweight evidence for UI
  reason?: string;     // plain reason
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function safeHostname(urlLike?: string): string | undefined {
  if (!urlLike) return undefined;
  try {
    const u = urlLike.startsWith("http") ? new URL(urlLike) : new URL(`https://${urlLike}`);
    return u.hostname;
  } catch { return undefined; }
}

function scoreFromTitle(t: string): number {
  const s = t.toLowerCase();
  let score = 0.25;
  if (/\b(warehouse|distribution center|fulfillment|dc|cold storage)\b/.test(s)) score += 0.2;
  if (/\b(open|opens|opening|launched|launches|debut|grand opening)\b/.test(s)) score += 0.35;
  if (/\b(expand|expands|expansion|adds|new facility)\b/.test(s)) score += 0.25;
  if (/\b(hire|hiring|jobs)\b/.test(s)) score += 0.1;
  return Math.max(0.1, Math.min(1, score));
}

function buildQueries(discovery: Discovery): string[] {
  const personaTxt = [
    discovery?.persona?.offer,
    discovery?.persona?.solves,
    ...(Array.isArray(discovery?.latents) ? discovery!.latents! : []),
  ].filter(Boolean).join(" ").toLowerCase();

  const seeds = new Set<string>([
    // openings / launches
    '(warehouse OR "distribution center" OR "fulfillment center" OR "cold storage") (open OR opens OR opening OR launched OR launch)',
    // expansions
    '(warehouse OR "distribution center" OR "fulfillment center" OR "cold storage") (expand OR expansion OR adds OR "new facility")',
    // retail / manufacturer activity (often packaging buyers)
    '(retail OR e-commerce OR manufacturer) ("new warehouse" OR "new distribution center")',
  ]);

  if (personaTxt.includes("corrugated") || personaTxt.includes("box")) {
    seeds.add('(corrugated OR boxes) (warehouse OR "distribution center") (open OR expand)');
  }
  if (personaTxt.includes("film") || personaTxt.includes("stretch")) {
    seeds.add('(stretch film OR pallet OR wrap) (warehouse OR "distribution center")');
  }
  if (personaTxt.includes("label")) {
    seeds.add('(labels OR labeling) (warehouse OR "distribution center") expansion');
  }
  return Array.from(seeds).slice(0, 6);
}

function parseRss(xml: string) {
  const out: { title: string; link: string; pubDate?: string }[] = [];
  const rxItem = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = rxItem.exec(xml))) {
    const chunk = m[1];
    const title =
      chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]?.trim() ||
      chunk.match(/<title>(.*?)<\/title>/)?.[1]?.trim() || "";
    const link =
      chunk.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ||
      chunk.match(/<guid.*?>(.*?)<\/guid>/)?.[1]?.trim() || "";
    const pubDate = chunk.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim();
    if (title && link) out.push({ title, link, pubDate });
  }
  return out;
}

async function fetchText(url: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (LeadsBot)" } });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  }
}

function googleRssUrl(region: "us" | "ca", q: string) {
  const hl = region === "ca" ? "en-CA" : "en-US";
  const gl = region === "ca" ? "CA" : "US";
  const ceid = region === "ca" ? "CA:en" : "US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:30d&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

function bingRssUrl(q: string) {
  // Bing News RSS
  return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&setlang=en-US`;
}

async function collectFromGoogle(region: "us" | "ca", q: string) {
  const xml = await fetchText(googleRssUrl(region, q));
  const items = parseRss(xml).slice(0, 20);
  return items.map(it => {
    const host = safeHostname(it.link) || "news.google.com";
    return {
      domain: host,
      title: it.title,
      score: scoreFromTitle(it.title),
      source: "News (Google RSS)",
      evidence: [{ detail: { title: it.title }, topic: "news.google.com", pubDate: it.pubDate }],
      reason: it.title,
    } as Candidate;
  });
}

async function collectFromBing(q: string) {
  const xml = await fetchText(bingRssUrl(q));
  const items = parseRss(xml).slice(0, 20);
  return items.map(it => {
    const host = safeHostname(it.link) || "bing.com";
    return {
      domain: host,
      title: it.title,
      score: scoreFromTitle(it.title),
      source: "News (Bing RSS)",
      evidence: [{ detail: { title: it.title }, topic: "bing.com", pubDate: it.pubDate }],
      reason: it.title,
    } as Candidate;
  });
}

// Registered adapters (kept empty-safe)
type Adapter = (d: Discovery, o: PipelineOpts) => Promise<Candidate[]>;
const ADAPTERS: Adapter[] = []; // wire your directory/search adapters here later

async function runAdapters(discovery: Discovery, opts: PipelineOpts): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const a of ADAPTERS) {
    try {
      const got = await a(discovery, opts);
      if (Array.isArray(got) && got.length) out.push(...got);
    } catch { /* swallow */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export default async function runPipeline(
  discovery: Discovery,
  opts: PipelineOpts = {}
): Promise<{ candidates: Candidate[] }> {
  // Normalize region: 'usca' => 'us' first; we can duplicate later if needed
  const r = (opts.region || "us").toLowerCase();
  const region: "us" | "ca" = r === "ca" ? "ca" : "us";

  // 1) Try your adapters
  let candidates: Candidate[] = await runAdapters(discovery, opts);

  // 2) Fallback: Google RSS
  if (!candidates.length) {
    const queries = buildQueries(discovery);
    const batches = await Promise.all(queries.map(q => collectFromGoogle(region, q)));
    candidates = batches.flat();
  }

  // 3) Secondary fallback: Bing RSS (in case Google yields thin results)
  if (!candidates.length) {
    const queries = buildQueries(discovery);
    const batches = await Promise.all(queries.map(q => collectFromBing(q)));
    candidates = batches.flat();
  }

  // Dedupe on domain|title
  const seen = new Set<string>();
  candidates = candidates.filter(c => {
    const key = `${(c.domain || "").toLowerCase()}|${(c.title || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // keep a reasonable batch
  if (candidates.length > 24) candidates = candidates.slice(0, 24);

  return { candidates };
}
