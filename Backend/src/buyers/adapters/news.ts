// Backend/src/buyers/adapters/news.ts
// Lightweight Google News RSS collector with zero extra npm deps.

export type NewsItem = {
  title: string;
  link: string;
  date?: string;
  description?: string;
  domain?: string;
  host?: string;
};

type RegionKey = "us" | "ca" | "usca";
const REGIONS: Record<Exclude<RegionKey, "usca">, { hl: string; gl: string; ceid: string }> = {
  us: { hl: "en-US", gl: "US", ceid: "US:en" },
  ca: { hl: "en-CA", gl: "CA", ceid: "CA:en" },
};

function pickDomainsFromGoogleLink(link: string): string | undefined {
  try {
    // Google News article links often have a final "url=" param.
    // If present, use that as the real source URL; else keep google host.
    const u = new URL(link);
    const urlParam = u.searchParams.get("url");
    if (urlParam) {
      const real = new URL(urlParam);
      return real.hostname.replace(/^www\./, "");
    }
    return u.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function between(s: string, a: string, b: string) {
  const i = s.indexOf(a);
  if (i === -1) return "";
  const j = s.indexOf(b, i + a.length);
  if (j === -1) return "";
  return s.slice(i + a.length, j);
}

function parseRss(xml: string): NewsItem[] {
  // Ultra-light RSS item parser: split on <item>…</item> blocks.
  const out: NewsItem[] = [];
  const parts = xml.split("<item>").slice(1);
  for (const part of parts) {
    const block = part.split("</item>")[0] || "";
    const title = between(block, "<title>", "</title>").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const link = between(block, "<link>", "</link>").trim();
    const pubDate = between(block, "<pubDate>", "</pubDate>").trim();
    const desc = between(block, "<description>", "</description>").replace(/<!\[CDATA\[|\]\]>/g, "").trim();

    if (!title || !link) continue;
    const host = pickDomainsFromGoogleLink(link) || "news.google.com";

    out.push({
      title,
      link,
      date: pubDate,
      description: desc,
      domain: host,
      host,
    });
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });
  if (!r.ok) throw new Error(`RSS fetch failed ${r.status}`);
  return await r.text();
}

function dedupe<T>(arr: T[], keyer: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of arr) {
    const k = keyer(it);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}

export async function collectNews(opts: {
  region?: RegionKey;
  query: string;
  limit?: number;
}): Promise<NewsItem[]> {
  const region = (opts.region || "usca").toLowerCase() as RegionKey;
  const limit = Math.max(1, Math.min(100, opts.limit ?? 24));
  const regs = region === "usca" ? (["us", "ca"] as const) : ([region] as unknown as ("us" | "ca")[]);

  let items: NewsItem[] = [];

  for (const reg of regs) {
    const conf = REGIONS[reg] || REGIONS.us;
    const params = new URLSearchParams({
      q: opts.query,
      hl: conf.hl,
      gl: conf.gl,
      ceid: conf.ceid,
    });
    const url = `https://news.google.com/rss/search?${params.toString()}`;

    try {
      const xml = await fetchText(url);
      const parsed = parseRss(xml);
      items = items.concat(parsed);
    } catch (e) {
      console.error("[collectNews] region", reg, "error:", (e as any)?.message || e);
    }
  }

  // dedupe by title+host, keep most recent first (Google RSS is already time-sorted)
  items = dedupe(items, (x) => `${x.title}::${x.host}`);
  return items.slice(0, limit);
}