// Focused internal crawler (dependency-free)
// - BFS over same-site links with a relevance score
// - Extracts HTML, plain text, <title> and key meta
// - Honors budgets (pages, per-page bytes, site bytes) and timeouts
// - Designed for packaging/manufacturing sites (URL heuristics tuned for that)
//
// Usage (in routes/classify.ts):
//   import { spiderHost } from "../shared/spider";
//   const crawl = await spiderHost("acme.com", { maxPages: 40 });
//
// Returns:
//   {
//     ok: true,
//     pages: Array<{
//       url: string;
//       score: number;
//       html: string;
//       text: string;
//       title?: string;
//       description?: string;
//       bytes: number;
//     }>,
//     stats: { fetched: number; queued: number; siteBytes: number; durationMs: number }
//   }

export type SpiderOptions = {
  // Crawl budget
  maxPages?: number;          // default 40
  perPageMaxBytes?: number;   // default 400_000 (~400 KB)
  siteMaxBytes?: number;      // default 6_000_000 (~6 MB)

  // Networking
  timeoutMs?: number;         // per request timeout (default 10_000)
  delayMs?: number;           // politeness delay between requests (default 100)

  // Prioritization
  candidateTails?: string[];  // paths we try first (default tuned below)
  allowQuery?: boolean;       // keep query strings (default false)
};

export type PageResult = {
  url: string;
  score: number;
  html: string;
  text: string;
  title?: string;
  description?: string;
  bytes: number;
};

export type SpiderResult = {
  ok: true;
  host: string;
  rootUrl: string;
  pages: PageResult[];
  stats: { fetched: number; queued: number; siteBytes: number; durationMs: number };
} | {
  ok: false;
  host: string;
  rootUrl: string;
  error: string;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
};

const F: (input: string, init?: any) => Promise<FetchResponse> = (globalThis as any).fetch;

// ———————————————————————————————————————————————————————————————
// Defaults & heuristics
// ———————————————————————————————————————————————————————————————

const DEFAULTS: Required<SpiderOptions> = {
  maxPages: 40,
  perPageMaxBytes: 400_000,
  siteMaxBytes: 6_000_000,
  timeoutMs: 10_000,
  delayMs: 100,
  allowQuery: false,
  candidateTails: [
    "products","product","catalog","collections",
    "markets","industries","industry","applications","solutions",
    "capabilities","services","equipment","materials",
    "packaging","films","film","shrink","stretch",
    "labels","label","boxes","cartons","corrugate","corrugated",
    "bottle","bottles","closures","pouch","pouches","clamshell","trays","tape"
  ]
};

// Paths we skip outright
const SKIP_RE = new RegExp(
  [
    "privacy","terms","legal","cookie","gdpr","accessibility",
    "careers","jobs","hiring","recruit","apply",
    "login","signin","signup","register","account","profile",
    "cart","checkout","wishlist","compare",
    "search","?s=","?q=","?search=",
    "feed","rss","xml","sitemap",
    "\\.pdf($|\\?)","\\.doc","\\.ppt","\\.xls","\\.zip","\\.rar",
    "calendar","events","press","news","blog(/|$)"
  ].join("|"),
  "i"
);

const POS_URL_HINTS = [
  "product","products","catalog","collections","solutions","applications",
  "industries","industry","markets","market",
  "capabilities","services","equipment","materials",
  "packaging","film","films","shrink","stretch","label","labels",
  "box","boxes","carton","cartons","corrugate","corrugated",
  "bottle","bottles","closure","closures","pouch","pouches","clamshell","tray","trays","tape"
];

const POS_TEXT_HINTS = [
  "packaging","converter","manufactur","distributor","private label","co-pack",
  "shrink","stretch","film","pallet","palletizing","containment","corrugate","carton","box",
  "label","bottle","closure","pouch","clamshell","blister","tray","foam","mailer"
];

// ———————————————————————————————————————————————————————————————
// Helpers
// ———————————————————————————————————————————————————————————————

function normHost(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function buildRootUrl(host: string): string {
  const h = normHost(host);
  return `https://${h}/`;
}

function sameHost(a: string, rootHost: string): boolean {
  try {
    const A = new URL(a);
    const h = normHost(A.host);
    const r = normHost(rootHost);
    return h === r;
  } catch { return false; }
}

function stripUrlNoise(u: string, allowQuery: boolean): string {
  try {
    const x = new URL(u);
    x.hash = "";
    if (!allowQuery) x.search = "";
    // Remove trailing slashes
    x.pathname = x.pathname.replace(/\/{2,}/g, "/");
    if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/$/, "");
    return x.toString();
  } catch { return u; }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<FetchResponse> {
  const ctl = new (globalThis as any).AbortController();
  const t = setTimeout(() => ctl.abort(), Math.max(200, timeoutMs));
  try {
    return await F(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        // A polite UA; some sites block the default.
        "User-Agent": "buyers-api-spider/1.0 (+internal; packaging discovery)"
      }
    });
  } finally { clearTimeout(t as any); }
}

// crude but fast HTML -> text/meta
function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1]?.trim();
}
function extractMetaDescription(html: string): string | undefined {
  const re = /<meta\s+(?:name|property)\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i;
  const m = html.match(re);
  return m?.[1]?.trim();
}
function htmlToText(html: string, cap = 200_000): string {
  const cleaned = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, cap);
}

// Extract internal links with their anchor text
function extractLinks(html: string, base: string): Array<{ url: string; text: string }> {
  const out: Array<{ url: string; text: string }> = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1]?.trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    let abs: string;
    try { abs = new URL(href, base).toString(); } catch { continue; }
    out.push({ url: abs, text: m[2]?.replace(/<[^>]+>/g, " ").trim() || "" });
  }
  return out;
}

// ———————————————————————————————————————————————————————————————
// Scoring
// ———————————————————————————————————————————————————————————————

function scoreCandidate(url: string, anchorText: string, pageTitle?: string): number {
  let s = 0;

  const u = url.toLowerCase();
  for (const w of POS_URL_HINTS) if (u.includes(w)) s += 2;

  const a = (anchorText || "").toLowerCase();
  for (const w of POS_TEXT_HINTS) if (a.includes(w)) s += 1.5;

  if (pageTitle) {
    const t = pageTitle.toLowerCase();
    for (const w of POS_TEXT_HINTS) if (t.includes(w)) s += 0.75;
  }

  // Penalize obvious non-content
  if (SKIP_RE.test(u)) s -= 5;

  // Small preference for shorter, cleaner paths
  s += Math.max(0, 2 - (u.split("/").length - 3) * 0.2);

  return Number(s.toFixed(3));
}

// ———————————————————————————————————————————————————————————————
// Public API
// ———————————————————————————————————————————————————————————————

export async function spiderHost(hostLike: string, opts?: SpiderOptions): Promise<SpiderResult> {
  const t0 = Date.now();
  const cfg = { ...DEFAULTS, ...(opts || {}) };

  const host = normHost(hostLike);
  const rootUrl = buildRootUrl(host);
  const visited = new Set<string>();
  const enqueued = new Set<string>();

  const pages: PageResult[] = [];
  let siteBytes = 0;

  // Priority queue (simple array we keep roughly sorted)
  type QItem = { url: string; score: number; seed?: boolean };
  const queue: QItem[] = [];

  function push(url: string, score: number, seed = false) {
    const clean = stripUrlNoise(url, cfg.allowQuery);
    if (enqueued.has(clean) || visited.has(clean)) return;
    if (!sameHost(clean, host)) return;
    if (SKIP_RE.test(clean)) return;
    enqueued.add(clean);
    queue.push({ url: clean, score, seed });
  }

  // Seed with homepage and helpful tails
  push(rootUrl, 10, true);
  for (const tail of cfg.candidateTails) {
    try {
      const u = new URL(rootUrl);
      const p = tail.startsWith("/") ? tail : `/${tail}`;
      u.pathname = (u.pathname.replace(/\/+$/, "") || "") + p;
      push(u.toString(), 9, true);
    } catch { /* ignore */ }
  }

  while (pages.length < cfg.maxPages && queue.length && siteBytes < cfg.siteMaxBytes) {
    // Pick highest score item
    queue.sort((a, b) => b.score - a.score);
    const next = queue.shift()!;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

    // Fetch
    let res: FetchResponse;
    try {
      res = await fetchWithTimeout(next.url, cfg.timeoutMs);
    } catch (err: any) {
      // Skip on network errors
      continue;
    }

    if (!res.ok) continue;

    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (!/text\/html|application\/xhtml\+xml/.test(ctype)) {
      // Non-HTML (skip, do not extract links)
      continue;
    }

    const buf = await res.arrayBuffer();
    const bytes = buf.byteLength;
    siteBytes += bytes;

    // Per-page hard cap: if too big, decode first chunk
    let html: string;
    if (bytes > cfg.perPageMaxBytes) {
      const sliced = buf.slice(0, cfg.perPageMaxBytes);
      html = new TextDecoder("utf-8").decode(sliced);
    } else {
      html = new TextDecoder("utf-8").decode(buf);
    }

    const title = extractTitle(html);
    const desc = extractMetaDescription(html);
    const text = htmlToText(html);

    const pageScore = Math.max(
      next.score,
      scoreCandidate(next.url, "", title)
    );

    pages.push({
      url: res.url || next.url,
      score: Number(pageScore.toFixed(3)),
      html,
      text,
      title,
      description: desc,
      bytes
    });

    if (pages.length >= cfg.maxPages || siteBytes >= cfg.siteMaxBytes) break;

    // Discover more links from this page
    const links = extractLinks(html, res.url || next.url);
    for (const { url, text: anchor } of links) {
      if (!sameHost(url, host)) continue;
      const sc = scoreCandidate(url, anchor, title);
      if (sc <= 0.2) continue; // very weak
      push(url, sc);
    }

    // politeness
    if (cfg.delayMs > 0) await sleep(cfg.delayMs);
  }

  return {
    ok: true,
    host,
    rootUrl,
    pages,
    stats: {
      fetched: pages.length,
      queued: queue.length,
      siteBytes,
      durationMs: Date.now() - t0
    }
  };
}

// Convenience: expose defaults (useful for diagnostics/tests)
export const SPIDER_DEFAULTS = Object.freeze({ ...DEFAULTS });
