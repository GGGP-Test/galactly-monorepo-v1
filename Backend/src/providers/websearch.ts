// Backend/src/providers/websearch.ts

import { Candidate, FindBuyersInput, ProviderResult, normalizeHost } from "./index";

/**
 * Key-less discovery using Bing News (RSS) + Bing Web (HTML) scraping.
 * We only extract hostnames; no heavy parsing. This keeps it fast & safe.
 * No DOM types, no AbortController (uses Promise.race timeout).
 */

export async function websearchProvider(input: FindBuyersInput): Promise<ProviderResult> {
  const supplierHost = normalizeHost(input.supplier);
  const kw = inferKeywordFromHost(supplierHost); // best-effort
  const titlesCSV = input.persona?.titles || "purchasing,procurement,buyer,sourcing";
  const regionQ = regionToQuery(input.region);

  const core = [kw, "packaging"].filter(Boolean).join(" ");
  const titlesQ = csvToOr(titlesCSV, ["purchasing", "procurement", "buyer", "sourcing"]);
  const q = ['"', core, '"', titlesQ, regionQ].filter(Boolean).join(" ");

  const rssUrl  = "https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss";
  const htmlUrl = "https://www.bing.com/search?q=" + encodeURIComponent(q);

  // 1) Try RSS first (usually cleaner)
  const rssText = await fetchTextWithTimeout(rssUrl, 5000).catch(() => "");
  const rssLinks = rssText
    ? Array.from(rssText.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/gi)).map(m => safeStr(m[1]))
    : [];

  // 2) Fallback to HTML if RSS too thin
  let htmlLinks: string[] = [];
  if (rssLinks.length < 6) {
    const html = await fetchTextWithTimeout(htmlUrl, 5000).catch(() => "");
    htmlLinks = html
      ? Array.from(html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/gi)).map(m => safeStr(m[1]))
      : [];
  }

  const rssHosts  = toHosts(rssLinks);
  const htmlHosts = toHosts(htmlLinks);

  const candidates: Candidate[] = [
    ...rssHosts.map(h => ({
      host: h, platform: "news", title: bestTitleFromPersona(titlesCSV),
      why: reason("news", core)
    })),
    ...htmlHosts.map(h => ({
      host: h, platform: "web", title: bestTitleFromPersona(titlesCSV),
      why: reason("web", core)
    }))
  ]
    .filter(c => c.host && c.host !== supplierHost && !isBlocked(c.host))
    .slice(0, 50);

  return { name: "websearch", candidates, debug: { q, rssUrl, htmlUrl } };

  function reason(src: string, c: string): string {
    return `Found with "${c}" (${src})`;
  }
}

/* ----------------------- helpers ----------------------- */

function csvToOr(csv: string, defaults: string[]): string {
  const list = (csv || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const use = list.length ? list : defaults;
  return "(" + use.map(t => `"${t}"`).join(" OR ") + ")";
}

function toHosts(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      if (!seen.has(host)) {
        seen.add(host);
        out.push(host);
      }
    } catch { /* ignore bad urls */ }
  }
  return out;
}

function bestTitleFromPersona(titlesCsv: string): string {
  const list = (titlesCsv || "").split(",").map(s => s.trim()).filter(Boolean);
  return list[0] || "Purchasing Manager";
}

function inferKeywordFromHost(host: string): string {
  const base = (host || "").split(".")[0] || "";
  if (base.includes("pack"))  return "packaging";
  if (base.includes("film"))  return "film";
  if (base.includes("label")) return "labels";
  return base.replace(/\d+/g, "").slice(0, 24);
}

function regionToQuery(region: string): string {
  const r = (region || "").toLowerCase();
  if (r.includes("us") && r.includes("ca")) return "(site:.com OR site:.us OR site:.ca)";
  if (r.startsWith("us")) return "(site:.com OR site:.us)";
  if (r.startsWith("ca")) return "(site:.ca)";
  return "";
}

function isBlocked(host: string): boolean {
  return BLOCK.some(b => host === b || host.endsWith(b) || host.includes(b));
}

function safeStr(s: unknown): string {
  return typeof s === "string" ? s : "";
}

const BLOCK: string[] = [
  "bing.com","microsoft.com","google.com","news.google",
  "facebook.com","twitter.com","linkedin.com","reddit.com",
  "youtube.com","wikipedia.org","medium.com","github.com",
  "npmjs.com","cloudflare.com","apple.news","apnews.com",
  "reuters.com","yahoo.com","newswire.com","prnewswire.com",
  "globenewswire.com","businesswire.com"
];

async function fetchTextWithTimeout(url: string, ms: number): Promise<string> {
  const t = setTimeout(() => { /* timeout sentinel */ }, ms);
  try {
    const res = await Promise.race([
      fetch(url, {
        // Very plain headers to avoid weird blocks; also avoids DOM header types
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          "Accept": "*/*"
        } as Record<string, string>
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
    ]);
    // If race returned the timeout promise, we’re already thrown.
    const r = res as Response;
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}