// Buyers pipeline with last-resort Google News RSS fallback.
// Node 20 has global fetch; no extra deps.

type Discovery = {
  supplierDomain?: string;
  persona?: any;
  latents?: string[];
  archetypes?: string[];
};

type PipelineOpts = {
  region?: "us" | "ca";
  radiusMi?: number; // kept for API shape, not used by RSS fallback
};

type Candidate = {
  domain?: string;
  website?: string;
  company?: string;
  name?: string;
  title?: string;
  score?: number;           // 0..1 – used for hot/warm threshold
  source?: string;          // adapter/source label
  evidence?: any[];         // lightweight evidence for the UI
  reason?: string;          // optional plain reason
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
  if (score > 1) score = 1;
  return Math.max(0.1, score);
}

function rssEndpoint(region: "us" | "ca", q: string): string {
  // Google News RSS search; keep it simple and reliable
  const base = "https://news.google.com/rss/search";
  const hl = region === "ca" ? "en-CA" : "en-US";
  const gl = region === "ca" ? "CA" : "US";
  const ceid = region === "ca" ? "CA:en" : "US:en";
  const url = `${base}?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  return url;
}

function parseRssItems(xml: string): { title: string; link: string; pubDate?: string }[] {
  const items: { title: string; link: string; pubDate?: string }[] = [];
  const rxItem = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = rxItem.exec(xml))) {
    const chunk = m[1];
    const title = (chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ??
                   chunk.match(/<title>(.*?)<\/title>/)?.[1] ?? "").trim();
    const link = (chunk.match(/<link>(.*?)<\/link>/)?.[1] ?? "").trim();
    const pubDate = chunk.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim();
    if (title && link) items.push({ title, link, pubDate });
  }
  return items;
}

// Pull a few orthogonal queries so we’re not brittle
function buildQueries(discovery: Discovery): string[] {
  const seeds: string[] = [];
  const personaTxt = [
    discovery?.persona?.offer,
    discovery?.persona?.solves,
    ...(Array.isArray(discovery?.latents) ? discovery!.latents! : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Base signals relevant to packaging suppliers’ buyers
  seeds.push(
    // openings / launches
    '(warehouse OR "distribution center" OR "fulfillment center" OR "cold storage") (open OR opens OR opening OR launched OR launch)',
    // expansions
    '(warehouse OR "distribution center" OR "fulfillment center" OR "cold storage") (expand OR expansion OR adds OR "new facility")',
    // retail / CPG activity (often packaging buyers)
    '(retail OR e-commerce OR manufacturer) ("new warehouse" OR "new distribution center")'
  );

  // If persona mentions corrugated, film, labels etc., bias words a bit
  if (personaTxt.includes("corrugated") || personaTxt.includes("box")) {
    seeds.push('(corrugated OR boxes) (warehouse OR "distribution center") (open OR expand)');
  }
  if (personaTxt.includes("film") || personaTxt.includes("stretch")) {
    seeds.push('(stretch film OR pallet OR wrap) (warehouse OR "distribution center")');
  }
  if (personaTxt.includes("label")) {
    seeds.push('(labels OR labeling) (warehouse OR "distribution center") expansion');
  }

  // De-dup and cap
  return Array.from(new Set(seeds)).slice(0, 5);
}

async function fetchNews(region: "us" | "ca", q: string) {
  const url = rssEndpoint(region, `${q} when:14d`);
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (LeadsBot)" } });
  if (!r.ok) {
    // be nice to the endpoint
    await sleep(300);
    return [];
  }
  const xml = await r.text();
  const items = parseRssItems(xml).slice(0, 12); // keep it small
  return items.map(it => {
    const host = safeHostname(it.link);
    const score = scoreFromTitle(it.title);
    const cand: Candidate = {
      domain: host,
      title: it.title,
      score,
      source: "News (RSS)",
      evidence: [{ detail: { title: it.title }, topic: "news.google.com", pubDate: it.pubDate }],
      reason: it.title
    };
    return cand;
  });
}

// ---------------------------------------------------------------------------
// Try any registered adapters (if you have them). For this drop-in we keep a
// tiny no-op list so the file compiles even if registry is empty.
// ---------------------------------------------------------------------------
type Adapter = (d: Discovery, o: PipelineOpts) => Promise<Candidate[]>;
const ADAPTERS: Adapter[] = []; // your existing adapters can be wired here later

async function runAdapters(discovery: Discovery, opts: PipelineOpts): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const a of ADAPTERS) {
    try {
      const got = await a(discovery, opts);
      if (Array.isArray(got) && got.length) out.push(...got);
    } catch (e) {
      // swallow adapter errors to keep pipeline resilient
      // console.warn("[adapter error]", e);
    }
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
  const region: "us" | "ca" = (opts.region === "ca" ? "ca" : "us");

  // 1) Try whatever adapters you already have configured.
  let candidates: Candidate[] = await runAdapters(discovery, { ...opts, region });

  // 2) Fallback: news RSS (guarantees time-sensitive signals)
  if (!candidates.length) {
    const queries = buildQueries(discovery);
    const chunks = await Promise.all(queries.map(q => fetchNews(region, q)));
    const flattened = chunks.flat();

    // light dedupe by title|domain
    const seen = new Set<string>();
    candidates = flattened.filter(c => {
      const key = `${(c.domain || "").toLowerCase()}|${(c.title || "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return { candidates };
}
