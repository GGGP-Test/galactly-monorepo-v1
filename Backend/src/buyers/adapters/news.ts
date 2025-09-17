// Backend/src/buyers/adapters/news.ts
// Stronger free collector: facility openings / expansions -> company domain extraction with robust fallbacks.

export type Region = "us" | "ca" | "usca";
export interface PersonaLite { offer?: string; solves?: string; titles?: string; }
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

// Expand blocklist to avoid generic news/PR/social
const BLOCKLIST = new Set<string>([
  "news.google.com","apnews.com","reuters.com","bloomberg.com","finance.yahoo.com",
  "youtube.com","twitter.com","x.com","facebook.com","linkedin.com",
  "globenewswire.com","prnewswire.com","businesswire.com","marketwatch.com",
  "seekingalpha.com","benzinga.com","msn.com","forbes.com","cnbc.com","cnn.com",
  "nytimes.com","washingtonpost.com","wsj.com","yahoo.com","foxbusiness.com",
  "medium.com","substack.com"
]);

function nowIso() { return new Date().toISOString(); }
function daysAgo(n:number) { return new Date(Date.now() - n*86400_000); }
function isRecent(pub:string, maxDays=14) {
  const d = new Date(pub); return !isNaN(d.getTime()) && d >= daysAgo(maxDays);
}

// very simple apex (example.org, example.co.uk naive => uk gets lost; acceptable for our targets)
function apex(host:string): string {
  const h = host.replace(/^www\./,"").toLowerCase();
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}

function toHostname(u:string): string {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./,""); } catch { return ""; }
}

function regionParams(r:Region) {
  if (r==="us") return "hl=en-US&gl=US&ceid=US:en";
  if (r==="ca") return "hl=en-CA&gl=CA&ceid=CA:en";
  return "hl=en-US&gl=US&ceid=US:en";
}

function baseQuery(): string {
  // Focus on logistics-relevant facility events
  return [
    '(',
    '"distribution center" OR "fulfillment center" OR warehouse OR "cold storage" OR "3PL" OR "logistics hub"',
    ')',
    '(',
    'opens OR opening OR launch OR launches OR expansion OR expands OR "new facility" OR "new site" OR "grand opening" OR "starts shipping"',
    ')'
  ].join(" ");
}

function buildQuery(p?:PersonaLite): string {
  const q = baseQuery();
  const ex: string[] = [];
  if (p && p.solves) {
    const t = String(p.solves).replace(/"/g,"").trim();
    if (t) ex.push(`"${t}"`);
  }
  return [q, ...ex].join(" ");
}

async function fetchText(url:string, timeoutMs=12000): Promise<string> {
  const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "user-agent":"Mozilla/5.0 GGGP/LeadFinder" } });
    return await r.text();
  } catch { return ""; } finally { clearTimeout(t); }
}

// tiny XML helpers
function firstBetween(xml:string, tag:string): string {
  const open = "<"+tag+">", close = "</"+tag+">";
  const i = xml.indexOf(open); if (i<0) return "";
  const j = xml.indexOf(close, i+open.length); if (j<0) return "";
  return xml.slice(i+open.length, j).trim();
}
function itemsOf(xml:string): string[] {
  const items:string[] = []; let s=0;
  while (true) {
    const i = xml.indexOf("<item>", s); if (i<0) break;
    const j = xml.indexOf("</item>", i+6); if (j<0) break;
    items.push(xml.slice(i, j+7)); s = j+7;
  }
  return items;
}
function cleanTitle(t:string){ const k=t.indexOf(" - "); return k>0 ? t.slice(0,k).trim() : t.trim(); }

function hotByTitleAndRecency(title:string, pub:string): boolean {
  const t = title.toLowerCase();
  const hotWords = ["opens","opening","launches","launch","starts shipping","grand opening"];
  const kw = hotWords.some(w => t.indexOf(w) >= 0);
  return kw && isRecent(pub, 14);
}
function recencyScore(pub:string): number {
  const dt = new Date(pub); if (isNaN(dt.getTime())) return 0.4;
  const age = Math.max(0, Math.floor((Date.now()-dt.getTime())/86400_000));
  const s = 1/Math.max(1, age+1); return Math.max(0.2, Math.min(1, +s.toFixed(2)));
}

function readAttr(tagHtml:string, attr:string): string {
  const re = new RegExp(attr+'\\s*=\\s*["\']([^"\']+)["\']', 'i'); const m = re.exec(tagHtml);
  return m?m[1]:"";
}
function matchMetaLink(html:string, tag:"link"|"meta", k:string, v:string, attr:string): string {
  const lower = html.toLowerCase(); const open = "<"+tag; let pos=0;
  while (true) {
    const i = lower.indexOf(open, pos); if (i<0) return "";
    const j = lower.indexOf(">", i+open.length); if (j<0) return "";
    const frag = html.slice(i, j+1); const fragLower = lower.slice(i, j+1);
    if (fragLower.indexOf(k+'="'+v+'"')>=0 || fragLower.indexOf(k+"='"+v+"'")>=0) {
      const hv = readAttr(frag, attr); if (hv) return hv;
    }
    pos = j+1;
  }
}

// Last-resort: try to find the official domain by company name via DuckDuckGo HTML results
async function lookupDomainByName(name:string): Promise<string> {
  const q = encodeURIComponent(name + " official site");
  const html = await fetchText("https://duckduckgo.com/html/?q="+q, 10000);
  if (!html) return "";
  // crude extract: first result link
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/i;
  const m = re.exec(html);
  if (!m) return "";
  const h = toHostname(m[1]); if (!h) return "";
  const ax = apex(h);
  if (BLOCKLIST.has(ax)) return "";
  return ax;
}

function guessCompanyNameFromTitle(title:string): string {
  // Heuristic: "Acme opens new distribution center in Dallas" -> "Acme"
  const colon = title.indexOf(":"); if (colon>0) title = title.slice(0, colon);
  const dash = title.indexOf(" - "); if (dash>0) title = title.slice(0, dash);
  // take first chunk up to "opens|opening|launch|expands"
  const stopWords = [" opens"," opening"," launch"," launches"," expands"," expansion"," starts"," unveils"," announces"];
  let cut = title.length;
  for (const w of stopWords) {
    const i = title.toLowerCase().indexOf(w);
    if (i>0) cut = Math.min(cut, i);
  }
  return title.slice(0, cut).trim();
}

function textFindFirstDomain(html:string): string {
  // catch simple www.* occurrences when not anchored
  const re = /(https?:\/\/)?(www\.)?([a-z0-9-]+(\.[a-z0-9-]+)+)/ig;
  let m:RegExpExecArray|null;
  while ((m = re.exec(html))) {
    const h = (m[3]||"").toLowerCase();
    const ax = apex(h);
    if (!ax) continue;
    if (BLOCKLIST.has(ax)) continue;
    return ax;
  }
  return "";
}

function extractCompanyDomain(articleUrl:string, html:string, title:string): Promise<string> | string {
  const canonical = matchMetaLink(html, "link", "rel", "canonical", "href");
  const ogUrl     = matchMetaLink(html, "meta", "property", "og:url", "content");
  const primary   = toHostname(canonical || ogUrl || articleUrl);
  if (primary) {
    const ax = apex(primary);
    if (ax && !BLOCKLIST.has(ax)) return ax;
  }
  // scan anchors for outbound company link
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi; let m:RegExpExecArray|null;
  while ((m = re.exec(html))) {
    const href = m[1]; if (!/^https?:/i.test(href)) continue;
    const h = toHostname(href); if (!h) continue;
    const ax = apex(h); if (!ax || BLOCKLIST.has(ax)) continue;
    return ax;
  }
  // plain text domain
  const d = textFindFirstDomain(html);
  if (d) return d;

  // fallback to searching by company name
  const name = guessCompanyNameFromTitle(title);
  if (name) return lookupDomainByName(name);
  return "";
}

export async function collectNews(opts: {
  supplierDomain: string;
  region?: Region;
  radiusMi?: number;
  persona?: PersonaLite;
}): Promise<Candidate[]> {
  const supplier = apex(String(opts.supplierDomain||"").toLowerCase());
  const region = (opts.region || "usca") as Region;

  const qp = new URLSearchParams();
  qp.set("q", buildQuery(opts.persona));
  const url = NEWS_BASE + "?" + qp.toString() + "&" + regionParams(region);

  const xml = await fetchText(url, 10000);
  if (!xml) return [];

  const items = itemsOf(xml).slice(0, 20); // keep bounded
  const out: Candidate[] = [];

  for (const it of items) {
    if (out.length >= 12) break; // cap
    const titleRaw = firstBetween(it, "title");
    const link = firstBetween(it, "link");
    const pub = firstBetween(it, "pubDate");
    const title = cleanTitle(titleRaw);
    if (!title || !link) continue;

    const articleHtml = await fetchText(link, 10000);
    if (!articleHtml) continue;

    const domMaybe = await extractCompanyDomain(link, articleHtml, title);
    const domain = typeof domMaybe === "string" ? domMaybe : await domMaybe;
    if (!domain) continue;

    const ax = apex(domain);
    if (!ax || BLOCKLIST.has(ax)) continue;
    if (ax === supplier) continue; // never return supplier itself

    const hot = hotByTitleAndRecency(title, pub);

    out.push({
      host: ax,
      title,
      temperature: hot ? "hot" : "warm",
      whyText: `${title} (${new Date(pub).toDateString()})`,
      why: {
        signal: { label: hot ? "Opening/launch signal" : "Expansion signal", score: recencyScore(pub), detail: title },
        context: { label: "News (RSS)", detail: toHostname(link) }
      },
      created: nowIso()
    });
  }

  return out;
}
