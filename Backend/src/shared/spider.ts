// Lightweight multi-page spider (no external deps)
// - BFS crawl limited by pages, bytes and time
// - Extracts title, meta description/keywords and visible text
// - Returns an aggregate + per-page details
//
// Used by routes/classify.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SpiderOptions {
  /** Max pages to visit (default 6, hard cap 24) */
  maxPages?: number;
  /** Abort overall crawl if aggregate bytes exceed this (default 1.5MB) */
  maxBytes?: number;
  /** Per-request timeout in ms (default 7000) */
  timeoutMs?: number;
  /** Optional UA string */
  userAgent?: string;
}

export type SpiderPage = {
  url: string;
  title?: string;
  text: string;
  bytes: number;
};

export type SpiderCrawl = {
  pages: SpiderPage[];
  text: string;
  title: string;
  description: string;
  keywords: string[];
  bytes: number;
};

const F: (u: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}> = (globalThis as any).fetch;

function normHost(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function toAbs(baseHost: string, href: string): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || h.startsWith("#") || h.startsWith("mailto:") || h.startsWith("tel:")) return null;
  if (h.match(/\.(pdf|zip|png|jpg|jpeg|gif|svg|webp|mp4|avi|mov)(\?|$)/i)) return null;

  try {
    // Absolute
    if (h.startsWith("http://") || h.startsWith("https://")) {
      const u = new URL(h);
      if (u.hostname.endsWith(baseHost)) return u.toString();
      return null;
    }
    // Root-relative
    if (h.startsWith("/")) return `https://${baseHost}${h}`;
    // Relative
    return `https://${baseHost}/${h}`;
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  let s = html;
  // drop scripts/styles/noscript
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  // comments
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // tags
  s = s.replace(/<\/?[^>]+>/g, " ");
  // entities (very small subset)
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  // spaces
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function pickTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).slice(0, 200) : "";
}

function pickMeta(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

function pickKeywords(html: string): string[] {
  const raw = pickMeta(html, "keywords");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 24);
}

async function fetchWithTimeout(url: string, timeoutMs: number, ua?: string): Promise<{ ok: boolean; status: number; text: string; bytes: number; html: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Math.max(100, timeoutMs));
  try {
    const res = await F(url, {
      redirect: "follow",
      signal: ac.signal as any,
      headers: ua ? { "User-Agent": ua } : undefined,
    });
    if (!res.ok) return { ok: false, status: res.status, text: "", bytes: 0, html: "" };
    const html = await res.text();
    const bytes = Buffer.byteLength(html, "utf8");
    const text = stripTags(html);
    return { ok: true, status: res.status, text, bytes, html };
  } finally {
    clearTimeout(t);
  }
}

export async function spiderHost(hostLike: string, opts: SpiderOptions = {}): Promise<SpiderCrawl> {
  const host = normHost(hostLike);
  const maxPages = Math.min(Math.max(1, opts.maxPages ?? 6), 24);
  const maxBytes = Math.max(250_000, opts.maxBytes ?? 1_500_000);
  const timeoutMs = Math.max(1000, opts.timeoutMs ?? 7000);
  const ua = opts.userAgent;

  const seen = new Set<string>();
  const q: string[] = [];

  // Seed with some likely-interesting paths
  const seeds = ["", "/", "/products", "/product", "/catalog", "/shop", "/store", "/industries", "/markets", "/applications", "/about", "/services"];
  for (const p of seeds) q.push(`https://${host}${p}`);

  const pages: SpiderPage[] = [];
  let totalBytes = 0;
  let aggTitle = "";
  let aggDesc = "";
  const aggKeywords = new Set<string>();

  while (q.length && pages.length < maxPages && totalBytes < maxBytes) {
    const url = q.shift() as string;
    if (seen.has(url)) continue;
    seen.add(url);

    try {
      const { ok, text, bytes, html } = await fetchWithTimeout(url, timeoutMs, ua);
      if (!ok) continue;

      totalBytes += bytes;
      if (totalBytes > maxBytes) break;

      const title = pickTitle(html) || undefined;
      const desc = pickMeta(html, "description");
      const kws = pickKeywords(html);
      for (const k of kws) aggKeywords.add(k);
      if (!aggTitle && title) aggTitle = title;
      if (!aggDesc && desc) aggDesc = desc;

      // collect links for BFS
      const linkMatches = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [];
      for (const tag of linkMatches) {
        const m = tag.match(/href=["']([^"']+)["']/i);
        const href = m ? m[1] : "";
        const abs = toAbs(host, href);
        if (abs && !seen.has(abs)) q.push(abs);
      }

      pages.push({ url, title, text, bytes });
    } catch {
      // ignore individual page failures
    }
  }

  const aggregateText = pages.map((p) => p.text).join("\n");
  const crawl: SpiderCrawl = {
    pages,
    text: aggregateText,
    title: aggTitle,
    description: aggDesc,
    keywords: Array.from(aggKeywords),
    bytes: totalBytes,
  };
  return crawl;
}

export default spiderHost;