// Backend/src/buyers/adapters/news.ts
// Free “warm/hot” collector using Google News RSS (no API key).
// Produces non-generic signals: facility openings/expansions/etc.
// Keeps output explainable via whyText + chips and avoids supplier domain.

export type Region = "us" | "ca" | "usca";

export interface PersonaLite {
  offer?: string;
  solves?: string;
  titles?: string;
}

export interface Candidate {
  host: string;
  company?: string;
  title?: string;
  platform?: string;
  temperature?: "warm" | "hot";
  whyText?: string;
  why?: {
    signal?: { label?: string; score?: number; detail?: string };
    context?: { label?: string; detail?: string };
    meta?: { label?: string; score?: number; detail?: string };
  };
  created?: string;
}

const NEWS_BASE = "https://news.google.com/rss/search";

const BLOCKLIST_HOSTS = new Set<string>([
  "news.google.com",
  "apnews.com",
  "reuters.com",
  "bloomberg.com",
  "finance.yahoo.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "linkedin.com",
  "globenewswire.com",
  "prnewswire.com",
  "businesswire.com",
  "marketwatch.com"
]);

function nowIso(): string {
  return new Date().toISOString();
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400_000);
}
function isRecent(pubDate: string, maxDays = 14): boolean {
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return false;
  return d >= daysAgo(maxDays);
}
function toHostname(u: string): string {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function regionParams(region: Region): string {
  if (region === "us") return "hl=en-US&gl=US&ceid=US:en";
  if (region === "ca") return "hl=en-CA&gl=CA&ceid=CA:en";
  return "hl=en-US&gl=US&ceid=US:en"; // default for "usca"
}

function baseQuery(): string {
  // Keep the query focused on logistics-relevant facility events.
  return [
    '(',
    '"distribution center"',
    'OR "fulfillment center"',
    'OR "warehouse"',
    'OR "3PL"',
    'OR "cold storage"',
    ')',
    '(',
    'opens',
    'OR opening',
    'OR launch',
    'OR launches',
    'OR expansion',
    'OR expands',
    'OR "new facility"',
    'OR "new site"',
    'OR "starts shipping"',
    ')'
  ].join(" ");
}

function buildQuery(persona?: PersonaLite): string {
  // Persona terms are optional hints only (prevent generic drift).
  const q = baseQuery();
  const extras: string[] = [];
  if (persona && persona.solves) {
    const t = String(persona.solves).replace(/"/g, "");
    if (t) extras.push('"' + t + '"');
  }
  return [q, ...extras].join(" ");
}

async function fetchText(url: string, timeoutMs = 12000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 GGGP/LeadFinder" }
    });
    return await r.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// Tiny XML helpers (no DOMParser needed)
function firstBetween(xml: string, tag: string): string {
  const open = "<" + tag + ">";
  const close = "</" + tag + ">";
  const i = xml.indexOf(open);
  if (i === -1) return "";
  const j = xml.indexOf(close, i + open.length);
  if (j === -1) return "";
  return xml.slice(i + open.length, j).trim();
}
function itemsOf(xml: string): string[] {
  const items: string[] = [];
  let start = 0;
  while (true) {
    const i = xml.indexOf("<item>", start);
    if (i === -1) break;
    const j = xml.indexOf("</item>", i + 6);
    if (j === -1) break;
    items.push(xml.slice(i, j + 7));
    start = j + 7;
  }
  return items;
}

function cleanTitle(t: string): string {
  // remove " - Site" tail to keep title lean
  const k = t.indexOf(" - ");
  return k > 0 ? t.slice(0, k).trim() : t.trim();
}

function hotByTitleAndRecency(title: string, pub: string): boolean {
  const t = title.toLowerCase();
  const hotWords = ["opens", "opening", "launches", "launch", "starts shipping", "grand opening"];
  const kw = hotWords.some(w => t.indexOf(w) >= 0);
  return kw && isRecent(pub, 14);
}

function recencyScore(pub: string): number {
  const dt = new Date(pub);
  if (isNaN(dt.getTime())) return 0.3;
  const ageDays = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86400_000));
  const s = 1 / Math.max(1, ageDays + 1);
  return Math.max(0.2, Math.min(1, +s.toFixed(2)));
}

// Try extracting a likely company domain from article HTML:
// 1) <link rel="canonical" href="..."> or <meta property="og:url" content="...">
// 2) if those are a news host, scan for the first external link that isn't a blocked host.
function extractCompanyDomain(articleUrl: string, html: string): string {
  const canonical = matchMetaLink(html, "link", "rel", "canonical", "href");
  const ogUrl = matchMetaLink(html, "meta", "property", "og:url", "content");
  const primary = toHostname(canonical || ogUrl || articleUrl);

  if (primary && !BLOCKLIST_HOSTS.has(primary)) return primary;

  // fallback: first outbound anchor that isn't the news domain or a known block
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (!/^https?:/i.test(href)) continue;
    const h = toHostname(href);
    if (!h || h === primary) continue;
    if (BLOCKLIST_HOSTS.has(h)) continue;
    // skip obvious shorteners
    if (h === "lnkd.in" || h === "t.co" || h === "bit.ly" || h === "goo.gl") continue;
    return h;
  }
  return "";
}

function matchMetaLink(html: string, tag: "link" | "meta", k: string, v: string, attr: string): string {
  // very basic attribute scan to avoid complex regex pitfalls
  const lower = html.toLowerCase();
  const open = "<" + tag;
  let pos = 0;
  while (true) {
    const i = lower.indexOf(open, pos);
    if (i === -1) return "";
    const j = lower.indexOf(">", i + open.length);
    if (j === -1) return "";
    const frag = html.slice(i, j + 1);
    const fragLower = lower.slice(i, j + 1);
    if (fragLower.indexOf(k + '="' + v + '"') >= 0 || fragLower.indexOf(k + "='" + v + "'") >= 0) {
      const hv = readAttr(frag, attr);
      if (hv) return hv;
    }
    pos = j + 1;
  }
}

function readAttr(tagHtml: string, attr: string): string {
  const re = new RegExp(attr + '\\s*=\\s*["\']([^"\']+)["\']', "i");
  const m = re.exec(tagHtml);
  return m ? m[1] : "";
}

export async function collectNews(opts: {
  supplierDomain: string;
  region?: Region;
  radiusMi?: number;   // unused for RSS; kept for interface parity
  persona?: PersonaLite;
}): Promise<Candidate[]> {
  const supplier = String(opts.supplierDomain || "").toLowerCase().replace(/^www\./, "");
  const region = (opts.region || "usca") as Region;

  const qp = new URLSearchParams();
  qp.set("q", buildQuery(opts.persona));
  const url = NEWS_BASE + "?" + qp.toString() + "&" + regionParams(region);

  const xml = await fetchText(url, 10000);
  if (!xml) return [];

  const items = itemsOf(xml);
  const out: Candidate[] = [];

  for (let idx = 0; idx < items.length && out.length < 20; idx++) {
    const it = items[idx];
    const titleRaw = firstBetween(it, "title");
    const link = firstBetween(it, "link");
    const pub = firstBetween(it, "pubDate");
    const title = cleanTitle(titleRaw);

    if (!title || !link) continue;

    const articleHtml = await fetchText(link, 10000);
    if (!articleHtml) continue;

    const domain = extractCompanyDomain(link, articleHtml);
    if (!domain) continue;

    if (domain === supplier) continue; // never return the supplier itself

    const hot = hotByTitleAndRecency(title, pub);

    out.push({
      host: domain,
      title: title,
      temperature: hot ? "hot" : "warm",
      whyText: title + " (" + new Date(pub).toDateString() + ")",
      why: {
        signal: {
          label: hot ? "Opening/launch signal" : "Expansion signal",
          score: recencyScore(pub),
          detail: title
        },
        context: { label: "News (RSS)", detail: toHostname(link) }
      },
      created: nowIso()
    });
  }

  return out;
}
