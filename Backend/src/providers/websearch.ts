import { Candidate, FindBuyersInput, ProviderResult, normalizeHost } from "./index";

// Simple search without API keys.
// Uses Bing News RSS (fast to parse) + fallback to Bing Web HTML.
// Extracts unique hostnames and returns lightweight candidates.

export async function websearchProvider(input: FindBuyersInput): Promise<ProviderResult> {
  const supplierHost = normalizeHost(input.supplier);
  const keyword = inferKeywordFromHost(supplierHost); // best-effort
  const titles = input.persona?.titles || "purchasing,procurement,buyer,sourcing";
  const regionToken = regionToQuery(input.region);

  const core = [keyword, "packaging"].filter(Boolean).join(" ");
  const q = [
    `"${core}"`,
    `(${titles.split(",").map(t => t.trim()).filter(Boolean).join(" OR ") || "purchasing"})`,
    regionToken
  ].filter(Boolean).join(" ");

  const rssUrl  = "https://www.bing.com/news/search?q=" + encodeURIComponent(q) + "&format=rss";
  const htmlUrl = "https://www.bing.com/search?q=" + encodeURIComponent(q);

  const rssLinks = await tryFetchText(rssUrl).then(text =>
    Array.from(text.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/gi)).map(m => m[1])
  ).catch(() => []);

  const htmlLinks = rssLinks.length >= 6 ? [] : await tryFetchText(htmlUrl).then(text =>
    Array.from(text.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/gi)).map(m => m[1])
  ).catch(() => []);

  const rssHosts  = toHosts(rssLinks);
  const htmlHosts = toHosts(htmlLinks);

  const candidates: Candidate[] = [
    ...rssHosts.map(h => ({
      host: h, platform: "news", title: bestTitleFromPersona(titles),
      why: `Mentioned with ${core} (news)`
    })),
    ...htmlHosts.map(h => ({
      host: h, platform: "web", title: bestTitleFromPersona(titles),
      why: `Found with ${core} (web)`
    }))
  ].filter(c => c.host && c.host !== supplierHost && !isBlocked(c.host));

  return { name: "websearch", candidates, debug: { q, rssUrl, htmlUrl } };
}

async function tryFetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, { headers: UA_HEADERS, signal: ctrl.signal as any });
    return await r.text();
  } finally {
    clearTimeout(id);
  }
}

const UA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "Accept": "*/*"
};

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
  return out.slice(0, 50);
}

function inferKeywordFromHost(host: string): string {
  const name = host.split(".")[0]; // e.g., "peekpackaging"
  if (name.includes("pack")) return "packaging";
  if (name.includes("film")) return "film";
  if (name.includes("label")) return "labels";
  return name.replace(/\d+/g, "").slice(0, 24);
}

function regionToQuery(region: string): string {
  const r = (region || "").toLowerCase();
  if (r.includes("us") && r.includes("ca")) return "(site:.com OR site:.us OR site:.ca)";
  if (r.startsWith("us")) return "(site:.com OR site:.us)";
  if (r.startsWith("ca")) return "(site:.ca)";
  return "";
}

function bestTitleFromPersona(titlesCsv: string): string {
  const list = (titlesCsv || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  return list[0] || "Purchasing Manager";
}

function isBlocked(host: string): boolean {
  return BLOCK.some(b => host.endsWith(b) || host === b || host.includes(b));
}

const BLOCK = [
  "bing.com","microsoft.com","google.com","news.google","facebook.com","twitter.com",
  "linkedin.com","reddit.com","youtube.com","wikipedia.org","medium.com","github.com",
  "npmjs.com","cloudflare.com"
];