// Backend/src/providers/websearch.ts

import type { Candidate, FindBuyersInput, ProviderResult } from "./types";
import { firstTitleFromCsv, normalizeHost, regionToQuery, toHosts } from "./shared";

/**
 * Key-less discovery via Bing News (RSS) + Bing Web (HTML).
 * If network is restricted, this returns [] and the caller backfills with seeds.
 */
export async function websearchProvider(input: FindBuyersInput): Promise<ProviderResult> {
  const supplierHost = normalizeHost(input.supplier);
  const kw = inferKeywordFromHost(supplierHost);
  const titlesCSV = input.persona?.titles || "purchasing,procurement,buyer,sourcing";
  const regionQ = regionToQuery(input.region);

  const core = [kw, "packaging"].filter(Boolean).join(" ");
  const titlesQ = toQuotedOr(titlesCSV, ["purchasing", "procurement", "buyer", "sourcing"]);
  const q = ['"', core, '"', titlesQ, regionQ].filter(Boolean).join(" ");

  const rssUrl  = "https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss";
  const htmlUrl = "https://www.bing.com/search?q=" + encodeURIComponent(q);

  let candidates: Candidate[] = [];

  // RSS (clean)
  const rssText = await fetchText(rssUrl, 6000).catch(() => "");
  if (rssText) {
    const links = Array.from(rssText.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/gi)).map(m => String(m[1] || ""));
    const hosts = toHosts(links);
    candidates.push(
      ...hosts
        .filter(h => h && h !== supplierHost && !isBlocked(h))
        .map(h => ({ host: h, platform: "news", title: firstTitleFromCsv(titlesCSV), why: `Found with "${core}" (news)` }))
    );
  }

  // HTML fallback if thin
  if (candidates.length < 6) {
    const html = await fetchText(htmlUrl, 6000).catch(() => "");
    if (html) {
      const links = Array.from(html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/gi)).map(m => String(m[1] || ""));
      const hosts = toHosts(links);
      candidates.push(
        ...hosts
          .filter(h => h && h !== supplierHost && !isBlocked(h))
          .map(h => ({ host: h, platform: "web", title: firstTitleFromCsv(titlesCSV), why: `Found with "${core}" (web)` }))
      );
    }
  }

  // cap & light dedupe here too
  const seen = new Set<string>();
  candidates = candidates.filter(c => {
    const k = (c.host || "").toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 50);

  return { name: "websearch", candidates, debug: { q } };
}

/* ----------------------- helpers ----------------------- */

function toQuotedOr(csv: string, defaults: string[]): string {
  const list = (csv || "").split(",").map(s => s.trim()).filter(Boolean);
  const use = list.length ? list : defaults;
  return "(" + use.map(t => `"${t}"`).join(" OR ") + ")";
}

function inferKeywordFromHost(host: string): string {
  const base = (host || "").split(".")[0] || "";
  if (base.includes("pack"))  return "packaging";
  if (base.includes("film"))  return "film";
  if (base.includes("label")) return "labels";
  return base.replace(/\d+/g, "").slice(0, 24);
}

function isBlocked(host: string): boolean {
  return BLOCK.some(b => host === b || host.endsWith(b) || host.includes(b));
}

const BLOCK: string[] = [
  "bing.com","microsoft.com","google.com","news.google",
  "facebook.com","twitter.com","linkedin.com","reddit.com",
  "youtube.com","wikipedia.org","medium.com","github.com",
  "npmjs.com","cloudflare.com","apnews.com","reuters.com",
  "yahoo.com","newswire.com","prnewswire.com","globenewswire.com",
  "businesswire.com"
];

async function fetchText(url: string, ms: number): Promise<string> {
  // use globalThis.fetch without DOM typings
  const fetchAny: any = (globalThis as any).fetch;
  if (!fetchAny) throw new Error("fetch unavailable in this runtime");
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));
  const res: any = await Promise.race([
    fetchAny(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept": "*/*"
      }
    }),
    timeout
  ]);
  return await res.text();
}