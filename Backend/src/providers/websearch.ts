import { Candidate, FindBuyersInput, ProviderResult, normalizeHost } from "./index";

// Simple, robust search that needs no API key.
// Strategy:
//  - Build a query around likely buyer titles + supplier category keyword(s)
//  - Try Bing News RSS first (easy to parse), then fallback to Bing HTML.
//  - Extract external hostnames, sanitize, dedupe at the caller level.

export async function websearchProvider(input: FindBuyersInput): Promise<ProviderResult> {
  const supplierHost = normalizeHost(input.supplier);
  const keyword = inferKeywordFromHost(supplierHost); // best-effort
  const titles = input.persona?.titles || "purchasing,procurement,buyer,sourcing";
  const regionToken = regionToQuery(input.region);

  const core = [keyword, "packaging"].filter(Boolean).join(" ");
  const query = [
    `"${core}"`,
    `(${titles.split(",").map(t => t.trim()).filter(Boolean).join(" OR ") || "purchasing"})`,
    regionToken
  ]
  .filter(Boolean)
  .join(" ");

  const rssUrl = "https://www.bing.com/news/search?q=" + encodeURIComponent(query) + "&format=rss";
  const htmlUrl = "https://www.bing.com/search?q=" + encodeURIComponent(query);

  const urls: string[] = [];

  // try RSS
  try {
    const rss = await fetch(rssUrl, { headers: UA_HEADERS });
    const xml = await rss.text();
    for (const m of xml.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/gi)) {
      urls.push(m[1]);
    }
  } catch {
    // ignore, we’ll fallback to html below
  }

  // fallback to HTML if RSS was too sparse
  if (urls.length < 6) {
    try {
      const htmlRes = await fetch(htmlUrl, { headers: UA_HEADERS });
      const html = await htmlRes.text();
      for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/gi)) {
        urls.push(m[1]);
      }
    } catch {
      // ignore
    }
  }

  const hosts = sanitizeToHosts(urls)
    .filter(h => h && !h.endsWith("bing.com") && !h.includes("microsoft.com"))
    .filter(h => h !== supplierHost);

  const candidates: Candidate[] = hosts.map(h => ({
    host: h,
    platform: "web",
    title: bestTitleFromPersona(titles),
    why: `Mentioned with ${core} (${input.region.toUpperCase()})`
  }));

  return { name: "websearch", candidates, debug: { query, rssUrl, htmlUrl } };
}

const UA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "Accept": "*/*"
};

function sanitizeToHosts(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const h = toHost(u);
    if (!h) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out.slice(0, 50);
}

function toHost(u: string): string {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function inferKeywordFromHost(host: string): string {
  // crude heuristics — safe, no external deps
  const name = host.split(".")[0]; // e.g., "peekpackaging"
  if (name.includes("pack")) return "packaging";
  if (name.includes("film")) return "film";
  if (name.includes("label")) return "labels";
  return name.replace(/\d+/g, "").slice(0, 24);
}

function regionToQuery(region: string): string {
  const r = (region || "").toLowerCase();
  if (r.startsWith("us")) return "(site:.com OR site:.us)";
  if (r.startsWith("ca")) return "(site:.ca)";
  if (r.includes("usca")) return "(site:.com OR site:.us OR site:.ca)";
  return "";
}

function bestTitleFromPersona(titlesCsv: string): string {
  const list = (titlesCsv || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return list[0] || "Purchasing Manager";
}