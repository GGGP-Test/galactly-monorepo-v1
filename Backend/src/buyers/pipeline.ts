// Buyers pipeline with detailed debug/tracing.
// Node 20 has global fetch.

type Discovery = {
  supplierDomain?: string;
  persona?: any;
  latents?: string[];
  archetypes?: string[];
};

type PipelineOpts = {
  region?: string;          // "us", "ca", "usca"
  radiusMi?: number;
  provider?: "google" | "bing" | "both";
  debug?: boolean;
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

export type PipelineDebug = {
  region: "us" | "ca";
  providerPlan: "google" | "bing" | "both";
  queries: {
    provider: "google" | "bing";
    query: string;
    url: string;
    ms: number;
    bytes: number;
    itemsParsed: number;
  }[];
  totalCandidates: number;
};

export type PipelineResult = { candidates: Candidate[]; debug?: PipelineDebug };

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
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
    '(warehouse OR "distribution center" OR "fulfillment center" OR "cold storage") (open OR opens OR opening OR launched OR launch)',
    '(warehouse OR "distribution center" OR "fulfillment center" OR "cold storage") (expand OR expansion OR adds OR "new facility")',
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
  if (!xml) return out;
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

async function fetchText(url: string): Promise<{ text: string; bytes: number; ms: number }> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (LeadsBot)" } });
    const text = r.ok ? await r.text() : "";
    const ms = Date.now() - t0;
    return { text, bytes: text.length, ms };
  } catch {
    const ms = Date.now() - t0;
    return { text: "", bytes: 0, ms };
  }
}

function googleRssUrl(region: "us" | "ca", q: string) {
  const hl = region === "ca" ? "en-CA" : "en-US";
  const gl = region === "ca" ? "CA" : "US";
  const ceid = region === "ca" ? "CA:en" : "US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:30d&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

function bingRssUrl(q: string) {
  return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&setlang=en-US`;
}

// Registered adapters (keep empty-safe; wire later if needed)
type Adapter = (d: Discovery, o: PipelineOpts) => Promise<Candidate[]>;
const ADAPTERS: Adapter[] = [];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default async function runPipeline(
  discovery: Discovery,
  opts: PipelineOpts = {}
): Promise<PipelineResult> {
  const r = (opts.region || "us").toLowerCase();
  const region: "us" | "ca" = r === "ca" ? "ca" : "us";
  const providerPlan: "google" | "bing" | "both" = opts.provider || "both";

  const debug: PipelineDebug = { region, providerPlan, queries: [], totalCandidates: 0 };

  // 1) Adapters first (if you register any later)
  let candidates: Candidate[] = [];
  for (const a of ADAPTERS) {
    try {
      const got = await a(discovery, opts);
      if (Array.isArray(got) && got.length) candidates.push(...got);
    } catch { /* ignore */ }
  }

  // 2) Build intent-driven queries
  const queries = buildQueries(discovery);

  // 3) Providers per plan
  const providers: ("google" | "bing")[] =
    providerPlan === "both" ? ["google", "bing"] : [providerPlan];

  for (const provider of providers) {
    for (const q of queries) {
      const url = provider === "google" ? googleRssUrl(region, q) : bingRssUrl(q);
      const { text, bytes, ms } = await fetchText(url);
      const items = parseRss(text);
      debug.queries.push({ provider, query: q, url, ms, bytes, itemsParsed: items.length });

      // Map to candidates
      for (const it of items.slice(0, 20)) {
        const host = safeHostname(it.link) || (provider === "google" ? "news.google.com" : "bing.com");
        const cand: Candidate = {
          domain: host,
          title: it.title,
          score: scoreFromTitle(it.title),
          source: provider === "google" ? "News (Google RSS)" : "News (Bing RSS)",
          evidence: [{ detail: { title: it.title }, topic: provider, pubDate: it.pubDate }],
          reason: it.title,
        };
        candidates.push(cand);
      }
    }
  }

  // Dedupe
  const seen = new Set<string>();
  candidates = candidates.filter(c => {
    const key = `${(c.domain || "").toLowerCase()}|${(c.title || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Limit
  if (candidates.length > 24) candidates = candidates.slice(0, 24);

  debug.totalCandidates = candidates.length;

  return { candidates, debug: opts.debug ? debug : undefined };
}
