// Backend/src/buyers/adapters/news.ts
// Free warm/hot signal collector via Google News RSS (no API key).
// Targets: openings/expansions of warehouses, DCs, fulfillment centers, 3PLs, cold storage, etc.

type Region = "us" | "ca" | "usca";

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
    meta?: { label?: string; score?: number; detail?: string };
    signal?: { label?: string; score?: number; detail?: string };
    context?: { label?: string; score?: number; detail?: string };
  };
  created?: string;
}

const NEWS_BASE = "https://news.google.com/rss/search";
const NOW = () => new Date();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

function regionParams(region: Region) {
  // Google News regionization via hl/gl/ceid; keep it simple.
  if (region === "us")  return "hl=en-US&gl=US&ceid=US:en";
  if (region === "ca")  return "hl=en-CA&gl=CA&ceid=CA:en";
  return "hl=en-US&gl=US&ceid=US:en"; // usca default to US english
}

function buildQuery(persona?: PersonaLite) {
  // Core intent: openings/expansions of logistics-heavy operations.
  const base =
    '( "distribution center" OR "fulfillment center" OR "warehouse" OR "3PL" OR "cold storage" ) ' +
    '( opens OR opening OR launch OR launches OR expansion OR expands OR "new facility" OR "new site" OR "starts shipping" )';
  // Persona can add flavor but we keep it conservative to avoid generic noise.
  const extras: string[] = [];
  if (persona?.solves) extras.push(`"${persona.solves.replace(/"/g, "")}"`);
  // Don’t force persona terms; optional signals only.
  return [base, ...extras].join(" ");
}

function textBetween(xml: string, tag: string) {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function iso(dateStr?: string) {
  try { return dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(); }
  catch { return new Date().toISOString(); }
}

function hostname(u: string) {
  try { return new URL(u).hostname.replace(/^www\\./, ""); } catch { return ""; }
}

function looksHot(title: string, pub: string) {
  const t = title.toLowerCase();
  const hotWords = ["opens", "opening", "launches", "launch", "starts shipping", "grand opening"];
  const isRecent = new Date(pub) >= daysAgo(14);
  const keywordHit = hotWords.some(w => t.includes(w));
  return isRecent && keywordHit;
}

function cleanTitle(t: string) {
  return t.replace(/ - .*$/, "").trim();
}

function scoreFromRecency(pub: string) {
  const ageDays = Math.max(0, Math.floor((NOW().getTime() - new Date(pub).getTime()) / 86400_000));
  // 0d -> 1.0, 30d -> ~0.2
  return Math.max(0.2, +(1 / Math.max(1, ageDays + 1)).toFixed(2));
}

const BLOCKLIST_HOSTS = new Set([
  "news.google.com", "apnews.com", "reuters.com", "bloomberg.com",
  "finance.yahoo.com", "youtube.com", "twitter.com", "x.com",
  "facebook.com", "linkedin.com", "globenewswire.com", "prnewswire.com",
  "businesswire.com", "marketwatch.com"
]);

async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 GGGP/LeadFinder" } });
    return await r.text();
  } catch {
    return "";
  } finally { clearTimeout(timer); }
}

// Try to find a probable company domain inside the article page (canonical/og:url or external company link).
function extractCompanyDomainFromArticle(articleUrl: string, html: string): string {
  const first = (re: RegExp) => (html.match(re)?.[1] || "").trim();
  // Prefer canonical url or og:url
  const canonical = first(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  const ogUrl     = first(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
  const primary = hostname(canonical || ogUrl || articleUrl);

  // If primary is a news site, scan for outbound links that look like company home pages.
  if (!BLOCKLIST_HOSTS.has(primary)) return primary;

  // Grab first external link that is not the article host and also not a known social/pr/news domain
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    const href = m[1];
    if (!/^https?:/i.test(href)) continue;
    const h = hostname(href);
    if (!h || h === primary) continue;
    if (BLOCKLIST_HOSTS.has(h)) continue;
    // Skip tracking / redirectors
    if (/^lnkd\.in$|^t\.co$|^bit\.ly$|^goo\.gl$/.test(h)) continue;
    return h;
  }
  return "";
}

export async function collectNews({
  supplierDomain,
  region = "usca",
  radiusMi = 50, // not used by RSS, kept for interface parity
  persona
}: {
  supplierDomain: string; region?: Region; radiusMi?: number; persona?: PersonaLite;
}): Promise<Candidate[]> {

  const qp = new URLSearchParams();
  qp.set("q", buildQuery(persona));
  // Sorting by date is the default via RSS feed.
  const params = regionParams(region as Region);
  const url = `${NEWS_BASE}?${qp.toString()}&${params}`;

  const xml = await fetchText(url, 10_000);
  if (!xml) return [];

  const itemsXml = xml.match(/<item>[\\s\\S]*?<\\/item>/gi) || [];
  const out: Candidate[] = [];

  for (const it of itemsXml.slice(0, 20)) { // cap per call
    const title = cleanTitle(textBetween(it, "title")[0] || "");
    const link  = textBetween(it, "link")[0] || "";
    const pub   = textBetween(it, "pubDate")[0] || "";

    if (!title || !link) continue;

    const articleHtml = await fetchText(link, 10_000);
    if (!articleHtml) continue;

    const domain = extractCompanyDomainFromArticle(link, articleHtml);
    if (!domain) continue;

    // Don’t suggest the supplier itself
    if (domain === supplierDomain.replace(/^www\\./, "")) continue;

    const hot = looksHot(title, pub);
    const score = scoreFromRecency(pub);

    out.push({
      host: domain,
      company: "", // unknown w/o enrichment; UI shows host link anyway
      title,
      temperature: hot ? "hot" : "warm",
      whyText: `${title} (${new Date(pub).toDateString()})`,
      why: {
        signal: { label: hot ? "Opening/launch signal" : "Expansion signal", score, detail: title },
        context: { label: "News (RSS)", detail: hostname(link) }
      },
      created: iso()
    });
  }

  return out;
}
