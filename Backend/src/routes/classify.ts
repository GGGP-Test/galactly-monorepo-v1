// src/routes/classify.ts
//
// High-completeness classifier (accuracy > speed):
//  • Up to 24 HTML pages per site (priority-scored BFS on internal links)
//  • robots.txt → sitemap(.xml|.xml.gz) → sitemap-index sampling (≤40 URLs)
//  • SPA-aware JSON mining (__NEXT_DATA__, __NUXT__, <script type=application/json>)
//  • Broader packaging lexicons (rigid/flexible/closures/trays/thermoform/etc.)
//  • “List up to 3, else ‘etc.’” rule for products & sectors
//
// GET  /api/classify?host=acme.com&email=user@acme.com
// POST /api/classify  { host, email }

import { Router, Request, Response as ExResponse } from "express";
import { withCache, daily } from "../shared/guards";
import { CFG } from "../shared/env";
import * as zlib from "zlib";

/* -------------------------------- fetch types ------------------------------ */
type FetchResponse = {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<any>;
};
const F: (input: string, init?: any) => Promise<FetchResponse> = (globalThis as any).fetch;

const r = Router();

/* ------------------------------- tiny helpers ------------------------------ */
function normalizeHost(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const h = String(raw).trim().toLowerCase();
    const clean = h.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!clean || !/^[a-z0-9.-]+$/.test(clean)) return undefined;
    return clean;
  } catch { return undefined; }
}
function emailsDomain(email?: string): string | undefined {
  if (!email) return undefined;
  const m = String(email).toLowerCase().match(/@([a-z0-9.-]+)/);
  return m?.[1];
}
function clientKey(req: Request): string {
  const apiKey = (req.headers["x-api-key"] || "") as string;
  const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
  return apiKey ? `k:${apiKey}` : `ip:${ip}`;
}
const UA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
async function timedFetch(url: string, timeoutMs: number): Promise<FetchResponse> {
  const ctl = new (globalThis as any).AbortController();
  const t = setTimeout(() => ctl.abort(), Math.max(500, timeoutMs));
  try { return await F(url, { signal: ctl.signal, redirect: "follow", headers: UA_HEADERS }); }
  finally { clearTimeout(t as any); }
}
function decodeUTF8(ab: ArrayBuffer): string {
  try { return new TextDecoder("utf-8").decode(ab); }
  catch { try { return new TextDecoder().decode(ab); } catch { return ""; } }
}
function maybeGunzip(buf: Buffer, url: string, contentType?: string): Buffer {
  try {
    if (url.endsWith(".gz") || /gzip/i.test(contentType || "")) {
      return zlib.gunzipSync(buf);
    }
  } catch { /* ignore */ }
  return buf;
}
function uniq<T>(a: T[]): T[] { return Array.from(new Set(a)); }
function sameHost(u: string, host: string): boolean {
  try {
    const h = new URL(u);
    const want = host.replace(/^www\./, "");
    const got = (h.hostname || "").replace(/^www\./, "");
    return want === got;
  } catch { return false; }
}
function joinForLine(list: string[]): string {
  const a = list.filter(Boolean);
  if (!a.length) return "";
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} & ${a[1]}`;
  if (a.length === 3) return `${a[0]}, ${a[1]} & ${a[2]}`;
  return `${a[0]}, ${a[1]}, ${a[2]}, etc.`;
}

/* ---------------------------- discovery seeds ------------------------------ */
const PATH_HINTS = [
  "", "/", "/home", "/about",
  "/products", "/solutions", "/services", "/packaging",
  "/markets", "/industries", "/segments", "/what-we-do", "/capabilities",
  "/portfolio", "/our-products", "/applications"
];
const LINK_KEYWORDS = [
  "product","packag","solution","service",
  "market","industry","segment","capabil","portfolio","application"
];
const SITEMAP_HINTS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/sitemap/sitemap.xml", "/robots.txt"];

function candidateSeeds(host: string): string[] {
  const h = host.replace(/^www\./, "");
  const bases = [`https://${h}`, `https://www.${h}`, `http://${h}`];
  const out: string[] = [];
  for (const b of bases) for (const t of PATH_HINTS) out.push(`${b}${t}`);
  return uniq(out);
}

/* ----------------------- HTML + SPA data extraction ------------------------ */
type ParseOut = {
  text: string;
  jsonld: string[];
  title?: string;
  description?: string;
  keywords?: string[];
  links: string[];
};
function extractTextMetaAndLinks(html: string, baseUrl: string, wantedHost: string): ParseOut {
  const meta: Record<string, string> = {};
  const reMeta = /<meta\s+[^>]*?(?:name|property)\s*=\s*["']([^"']+)["'][^>]*?content\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = reMeta.exec(html))) {
    const k = m[1].toLowerCase(); const v = m[2].trim();
    if (!meta[k]) meta[k] = v;
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim();
  const description = (meta["description"] || meta["og:description"] || meta["twitter:description"] || "").trim();
  const keywordsRaw = meta["keywords"];
  const keywords = keywordsRaw?.split(/[,;]|·/).map(s=>s.trim().toLowerCase()).filter(Boolean) || undefined;

  const linksAbs: string[] = [];
  const reA = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let a: RegExpExecArray | null;
  while ((a = reA.exec(html))) {
    const href = (a[1] || "").trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) continue;
    let abs: string;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    if (!sameHost(abs, wantedHost)) continue;
    const path = abs.split("?")[0].toLowerCase();
    if (LINK_KEYWORDS.some(k => path.includes(k))) linksAbs.push(abs);
  }

  const textPlain = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 400000)
    .trim();

  const jsonld: string[] = [];
  const reLD = /<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
  let ml: RegExpExecArray | null;
  while ((ml = reLD.exec(html))) {
    const payload = ml[1]?.trim();
    if (payload) jsonld.push(payload);
  }

  // SPA JSON blobs
  let spaText = "";
  const blobs: string[] = [];

  const nextRe = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
  const nextM = nextRe.exec(html);
  if (nextM?.[1]) blobs.push(nextM[1]);

  const nuxtRe = /window\.__NUXT__\s*=\s*({[\s\S]*?});/i;
  const nuxtM = nuxtRe.exec(html);
  if (nuxtM?.[1]) blobs.push(nuxtM[1]);

  const reJSON = /<script[^>]*type=['"]application\/json['"][^>]*>([\s\S]*?)<\/script>/gi;
  let jj: RegExpExecArray | null;
  while ((jj = reJSON.exec(html))) {
    const payload = (jj[1] || "").trim();
    if (payload.length < 400000) blobs.push(payload);
  }

  function collectStringsFromJSON(raw: string, budget = 24000): string {
    try {
      const obj = JSON.parse(raw);
      let out = "";
      let used = 0;
      const walk = (v: any) => {
        if (used >= budget) return;
        const t = typeof v;
        if (t === "string") {
          const s = v.replace(/\s+/g, " ").trim();
          if (s.length >= 3 && /[A-Za-z]/.test(s)) { out += " " + s; used += s.length; }
          return;
        }
        if (t === "number" || t === "boolean") return;
        if (Array.isArray(v)) { for (const x of v) { if (used >= budget) break; walk(x); } return; }
        if (v && t === "object") { for (const k of Object.keys(v)) { if (used >= budget) break; walk(v[k]); } }
      };
      walk(obj);
      return out;
    } catch { return ""; }
  }
  for (const b of blobs) {
    const s = collectStringsFromJSON(b);
    if (s) spaText += " " + s;
  }

  const combinedText = (textPlain + " " + spaText).trim();
  return { text: combinedText, jsonld, title, description, keywords, links: uniq(linksAbs) };
}

/* ---------------------------- robots + sitemaps ---------------------------- */
async function getSitemapUrls(host: string): Promise<string[]> {
  const out: string[] = [];
  // robots.txt first
  try {
    const robots = await timedFetch(`https://${host}/robots.txt`, 6000);
    if (robots.ok) {
      const txt = await robots.text();
      const lines = txt.split(/\r?\n/);
      for (const ln of lines) {
        const m = ln.match(/^\s*Sitemap:\s*(\S+)\s*$/i);
        if (m?.[1]) out.push(m[1].trim());
      }
    }
  } catch { /* ignore */ }

  // fallbacks
  if (!out.length) {
    for (const h of SITEMAP_HINTS) out.push(`https://${host}${h}`);
  }
  return uniq(out);
}

async function fetchXml(u: string): Promise<string | null> {
  try {
    const res = await timedFetch(u, 8000);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const ct = res.headers.get("content-type") || "";
    const data = maybeGunzip(buf, u, ct);
    return data.toString("utf8");
  } catch { return null; }
}

// extracts <loc> from sitemap or sitemap-index
function extractLocsFromXml(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) locs.push((m[1] || "").trim());
  return uniq(locs);
}

/* ------------------------ prioritized internal crawl ----------------------- */
type QItem = { url: string; score: number };
const LINK_BONUS = [
  { k: "packag", w: 6 },
  { k: "product", w: 5 },
  { k: "solution", w: 4 },
  { k: "industry", w: 4 },
  { k: "market", w: 4 },
  { k: "segment", w: 4 },
  { k: "service", w: 3 },
  { k: "application", w: 3 },
  { k: "portfolio", w: 2 }
];

function scorePath(u: string): number {
  const path = u.split("?")[0].toLowerCase();
  let s = 0;
  for (const {k, w} of LINK_BONUS) if (path.includes(k)) s += w;
  // shallower paths first
  const depth = (new URL(u).pathname || "/").split("/").filter(Boolean).length;
  s += Math.max(0, 6 - depth);
  return s;
}

/* ------------------------------ lexicons ----------------------------------- */
type Role = "packaging_supplier" | "packaging_buyer" | "neither";

const PRODUCT_LEX: Record<string, string[]> = {
  boxes: ["box","boxes","carton","cartons","rigid box","corrugated","mailer box","folding carton"],
  labels: ["label","labels","sticker","stickers"],
  pouches: ["pouch","pouches","stand up pouch","stand-up pouch","mylar","sachet","sachets"],
  bottles: ["bottle","bottles","vial","vials"],
  jars: ["jar","jars","tin","tins"],
  tape: ["tape","packaging tape"],
  corrugate: ["corrugate","corrugated","corrugated box","corrugated packaging"],
  mailers: ["mailer","mailers","poly mailer","mailer bag","polybag","poly bag"],
  clamshells: ["clamshell","clamshells","blister"],
  foam: ["foam insert","foam","eva foam"],
  pallets: ["pallet","pallets","palletizing","pallet wrap","stretch wrap"],
  shrink: ["shrink","shrink wrap","shrink film"],
  film: ["film","flexible film","laminate","laminated film","flexible packaging","flexibles"],
  closures: ["closure","closures","cap","caps","lids","lid","fitment","fitments"],
  trays: ["tray","trays","thermoform","thermoformed","thermoforming"],
  rigid: ["rigid","rigid packaging","tub","tubs","cup","cups","container","containers","hdpe","pet"]
};
const SECTOR_LEX: Record<string, string[]> = {
  food: ["food","grocery","snack","sauce","salsa","candy","baked","meals","deli"],
  beverage: ["beverage","drink","juice","soda","coffee","tea","brewery","beer","wine","distillery","dairy","water"],
  cosmetics: ["cosmetics","cosmetic","beauty","skincare","skin care","haircare","makeup","fragrance","personal care","home care"],
  supplements: ["supplement","nutraceutical","vitamin","sports nutrition"],
  electronics: ["electronics","devices","gadgets","semiconductor","pcb"],
  apparel: ["apparel","fashion","clothing","garment"],
  pharma: ["pharma","pharmaceutical","medical","medication","rx","otc","healthcare","health care"],
  pet: ["pet","pets","petcare","pet care"],
  automotive: ["automotive","auto","aftermarket"],
  home: ["home goods","home & garden","furniture","decor","household"],
  industrial: ["industrial","b2b","manufacturing","factory"],
  cannabis: ["cannabis","cbd","hemp"]
};

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function scoreLexicon(text: string, keywords?: string[]): (lex: Record<string, string[]>) => Record<string, number> {
  const t = text.toLowerCase();
  const kw = (keywords || []).join(" ").toLowerCase();
  return (lex) => {
    const scores: Record<string, number> = {};
    for (const [key, synonyms] of Object.entries(lex)) {
      let n = 0;
      for (const s of synonyms) {
        const re = new RegExp(`\\b${escapeRegExp(s.toLowerCase())}\\b`, "g");
        n += (t.match(re)?.length || 0) + (kw.match(re)?.length || 0);
      }
      if (n > 0) scores[key] = n;
    }
    return scores;
  };
}
function topKeys(scores: Record<string, number>, max = 8): string[] {
  return Object.entries(scores).sort((a,b)=>b[1]-a[1]).slice(0, max).map(([k]) => k);
}

function ruleClassify(text: string, jsonld: string[]): { role: Role; confidence: number; evidence: string[] } {
  const t = (text || "").toLowerCase();
  const productSignals = ["product","catalog","shop","store","price","sku","portfolio"];
  const packagingTokens = [
    "packaging","package","packages","converter","conversion",
    "box","boxes","carton","cartons","corrugate","corrugated",
    "label","labels","tape","pouch","pouches","sachet","sachets",
    "bottle","bottles","jar","jars","film","shrink","stretch",
    "pallet","pallets","thermoform","blister","tray","trays",
    "cup","cups","lid","lids","closure","closures","cap","caps",
    "rigid","flexible","laminate","coating","printing","container","containers"
  ];
  const buyerHints = ["brand","retail","ecommerce","our stores","locations","menu"];
  const supplierVerbs = ["manufacture","converter","convert","supply","supplier","wholesale","distributor","co-pack","contract pack","private label","produce","produces","global leader"];

  const contains = (arr: string[]) => arr.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);

  const prod = contains(productSignals);
  const pack = contains(packagingTokens);
  const buy = contains(buyerHints);
  const sup = contains(supplierVerbs);

  let scoreSupplier = sup + pack + (prod > 0 ? 1 : 0);
  let scoreBuyer = buy + (prod > 0 ? 1 : 0);

  for (const raw of jsonld) {
    try {
      const obj = JSON.parse(raw);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const o of arr) {
        const ttype = (o && (o["@type"] || o.type)) || "";
        const s = typeof ttype === "string" ? ttype.toLowerCase() : "";
        if (s.includes("wholesalestore") || s.includes("manufacturer") || s.includes("organization")) scoreSupplier += 1;
        if (s.includes("store") || s.includes("localbusiness") || s.includes("brand")) scoreBuyer += 1;
      }
    } catch { /* ignore */ }
  }

  const evidence: string[] = [];
  if (prod) evidence.push(`product_signals:${prod}`);
  if (pack) evidence.push(`packaging_terms:${pack}`);
  if (sup) evidence.push(`supplier_verbs:${sup}`);
  if (buy) evidence.push(`buyer_hints:${buy}`);

  if (scoreSupplier >= scoreBuyer && scoreSupplier >= 2)
    return { role: "packaging_supplier", confidence: Math.min(1, 0.55 + 0.1 * scoreSupplier), evidence };
  if (scoreBuyer >= 2)
    return { role: "packaging_buyer", confidence: Math.min(1, 0.55 + 0.1 * scoreBuyer), evidence };
  return { role: "neither", confidence: 0.35, evidence };
}

function suggestSectorMetrics(productTags: string[], sectorHints: string[]): Record<string,string[]> {
  const s = sectorHints.map(x=>x.toLowerCase());
  const p = productTags.map(x=>x.toLowerCase());
  const out: Record<string,string[]> = {};
  if (p.includes("boxes") || p.includes("corrugate")) {
    out["corrugate"] = [
      "ECT / stack strength at target weight",
      "Board grade & burst/Mullen targets",
      "Die-line, folding & glue integrity",
      "Print registration & brand color accuracy",
      "Damage reduction targets in transit",
      "Adhesive performance vs substrate & temperature",
      "Print finish & brand color match",
      "E-commerce fulfillment compatibility"
    ];
  }
  if (s.includes("beverage")) {
    out["beverage"] = [
      "Closure compatibility & torque",
      "Label application alignment & adhesion",
      "Bottle/secondary pack stability in transit",
      "Cold-chain / condensation resistance",
      "Lot traceability & COA",
      "E-commerce fulfillment compatibility"
    ];
  }
  if (s.includes("food")) {
    out["food"] = [
      "Food-contact compliance (FDA/EC)",
      "Moisture / oxygen barrier needs",
      "Seal integrity under process (hot-fill/retort)",
      "Case-packing line uptime impact",
      "Damage reduction targets in transit",
      "Unit cost at target MOQ"
    ];
  }
  if (s.includes("cosmetics")) {
    out["cosmetics"] = [
      "Print finish & brand color match",
      "Decor registration (foil/emboss/deboss)",
      "Label adhesion on varnished surfaces",
      "Carton rigidity vs weight",
      "Tamper-evidence features",
      "Retail scuff/scratch resistance"
    ];
  }
  if (s.includes("electronics")) {
    out["electronics"] = [
      "Drop/edge-crush protection at DIM weight",
      "ESD-safe packaging compliance",
      "Foam insert precision & fit",
      "Sealed-air / void-fill compatibility",
      "Outer carton strength at target cost"
    ];
  }
  if (s.includes("pharma")) {
    out["pharma"] = [
      "cGMP/FDA packaging compliance",
      "Lot traceability & COA",
      "Tamper-evident seal integrity",
      "Child-resistant closure certification",
      "Serialization / GS1 barcode placement"
    ];
  }
  if (s.includes("cannabis")) {
    out["cannabis"] = [
      "Child-resistant certification",
      "State regulatory label compliance",
      "Odor/light barrier performance",
      "Tamper-evidence integrity"
    ];
  }
  if (Object.keys(out).length === 0) {
    out["general"] = [
      "Damage reduction targets in transit",
      "Automation line uptime impact",
      "Sustainability targets (PCR %, recyclability)",
      "Unit cost at target MOQ"
    ];
  }
  return out;
}

/* ------------------------------ geo hints (US) ----------------------------- */
const US_ST_ABBR = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const US_ST_FULL = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];
function extractGeoHints(text: string): { citiesTop: string[]; statesTop: string[] } {
  const t = text || "";
  const cities = new Map<string, number>();
  const states = new Map<string, number>();
  const reCitySt = /\b([A-Z][A-Za-z .'-]{2,}?),\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/g;
  let m: RegExpExecArray | null;
  while ((m = reCitySt.exec(t))) {
    const city = m[1].trim(); const st = m[2].trim();
    cities.set(city, (cities.get(city) || 0) + 2);
    states.set(st, (states.get(st) || 0) + 2);
  }
  const reCityState = new RegExp(`\\b([A-Z][A-Za-z .'-]{2,}?),\\s*(${US_ST_FULL.join("|")})\\b`, "g");
  let n: RegExpExecArray | null;
  while ((n = reCityState.exec(t))) {
    const city = n[1].trim(); const st = n[2].trim();
    cities.set(city, (cities.get(city) || 0) + 1);
    states.set(st, (states.get(st) || 0) + 1);
  }
  const citiesTop = Array.from(cities.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k);
  const statesTop = Array.from(states.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k);
  return { citiesTop, statesTop };
}

/* --------------------------- one-liner composer ---------------------------- */
function composeOneLiner(host: string, role: Role, products: string[], sectors: string[], meta?: { title?: string; description?: string; }) {
  const shortHost = host.replace(/^www\./, "");
  const verb = role === "packaging_buyer" ? "buys packaging" :
               role === "packaging_supplier" ? "supplies packaging" : "does business";
  const prodBits = joinForLine(products.slice(0, Math.min(3, products.length)));
  const secBits = joinForLine(sectors.slice(0, Math.min(3, sectors.length)));
  let line = `${shortHost} ${verb}`;
  if (prodBits) line += ` — ${prodBits}`;
  if (secBits) line += ` for ${secBits} brands`;
  line += ".";
  const desc = meta?.description || meta?.title;
  if (desc && desc.length >= 40 && /packag/i.test(desc)) {
    const clean = desc.replace(/\s+/g, " ").trim();
    return clean.endsWith(".") ? clean : `${clean}.`;
  }
  return line;
}

/* ----------------------------- main crawling ------------------------------- */
async function fetchRich(host: string, opts?: { maxPages?: number }): Promise<{
  text: string;
  jsonld: string[];
  title?: string;
  description?: string;
  bytes: number;
  sources: string[];
}> {
  const MAX_PAGES = Math.max(6, Math.min(24, opts?.maxPages ?? 24)); // completeness-first
  const MAX_SITEMAP_URLS = 40;
  const tried = new Set<string>();
  const sources: string[] = [];
  let bytesTotal = 0;
  let title: string | undefined;
  let description: string | undefined;
  let textAll = "";
  const jsonldAll: string[] = [];

  // seeds
  const queue: QItem[] = candidateSeeds(host).map(u => ({ url: u, score: scorePath(u) }));

  // sitemaps (robots + hints)
  try {
    const siteMaps = await getSitemapUrls(host);
    for (const sm of siteMaps.slice(0, 6)) {
      const xml = await fetchXml(sm);
      if (!xml) continue;
      const locs = extractLocsFromXml(xml);
      // if it's a sitemap index, you get many sitemaps — sample a few
      const likely = locs
        .filter(u => sameHost(u, host))
        .filter(u => {
          const p = u.split("?")[0].toLowerCase();
          return LINK_KEYWORDS.some(k => p.includes(k));
        })
        .slice(0, MAX_SITEMAP_URLS);
      for (const u of likely) queue.push({ url: u, score: scorePath(u) + 8 });
    }
  } catch { /* ignore */ }

  // main crawl (priority queue; small concurrency)
  const takeBatch = (n: number) => {
    queue.sort((a,b) => b.score - a.score);
    const batch: QItem[] = [];
    while (queue.length && batch.length < n) {
      const it = queue.shift()!;
      if (tried.has(it.url)) continue;
      tried.add(it.url); batch.push(it);
    }
    return batch;
  };

  while (sources.length < MAX_PAGES) {
    const batch = takeBatch(4);
    if (!batch.length) break;

    const results = await Promise.all(batch.map(async it => {
      try {
        const res = await timedFetch(it.url, Math.max(CFG.fetchTimeoutMs, 9000));
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        const bytes = ab.byteLength;
        if (bytes > CFG.maxFetchBytes) return null;
        const html = decodeUTF8(ab);
        return { url: res.url || it.url, html };
      } catch { return null; }
    }));

    for (const r of results) {
      if (!r) continue;
      sources.push(r.url);
      const parsed = extractTextMetaAndLinks(r.html, r.url, host);
      if (!title && parsed.title) title = parsed.title;
      if (!description && parsed.description) description = parsed.description;
      jsonldAll.push(...parsed.jsonld);
      textAll += " \n " + parsed.text;
      bytesTotal += Buffer.byteLength(r.html, "utf8");

      // add a few more internal candidates discovered on-page
      for (const l of parsed.links.slice(0, 5)) {
        if (!tried.has(l)) queue.push({ url: l, score: scorePath(l) + 2 });
      }

      if (textAll.length > 30000) break;
    }
    if (textAll.length > 30000) break;
  }

  return { text: textAll.trim(), jsonld: jsonldAll, title, description, bytes: bytesTotal, sources: uniq(sources) };
}

/* -------------------------------- classify --------------------------------- */
async function classifyHostOnce(host: string) {
  const sample = await fetchRich(host, { maxPages: 24 });

  if (!sample.text || sample.text.length < 500) {
    return {
      ok: true,
      host,
      role: "neither",
      confidence: 0.3,
      summary: `${host.replace(/^www\./,"")} does business.`,
      productTags: [],
      sectorHints: ["General"],
      evidence: ["thin_site_or_blocked"],
      hotMetricsBySector: suggestSectorMetrics([], ["general"]),
      geoHints: { citiesTop: [], statesTop: [] },
      bytes: sample.bytes,
      fetchedAt: new Date().toISOString(),
      sources: sample.sources,
      cached: false
    };
  }

  const first = ruleClassify(sample.text, sample.jsonld);

  const scorer = scoreLexicon(sample.text);
  const productScores = scorer(PRODUCT_LEX);
  const sectorScores = scorer(SECTOR_LEX);

  let productTags = topKeys(productScores, 12);
  if (!productTags.length && /packag/i.test(sample.text)) productTags = ["packaging"];

  const sectorHintsRaw = topKeys(sectorScores, 8);
  const sectorHints = sectorHintsRaw.length ? sectorHintsRaw.map(s => s.replace(/\b\w/g, m => m.toUpperCase())) : ["General"];

  const summary = composeOneLiner(
    host,
    first.role,
    productTags,
    sectorHints,
    { title: sample.title, description: sample.description }
  );

  const hotMetricsBySector = suggestSectorMetrics(productTags, sectorHints);
  const geoHints = extractGeoHints(sample.text);

  return {
    ok: true,
    host,
    role: first.role,
    confidence: first.confidence,
    summary,
    productTags,
    sectorHints,
    evidence: first.evidence,
    hotMetricsBySector,
    geoHints,
    bytes: sample.bytes,
    fetchedAt: new Date().toISOString(),
    sources: sample.sources,
    cached: false
  };
}

/* --------------------------------- routes ---------------------------------- */
r.get("/", async (req: Request, res: ExResponse) => {
  try {
    const rawHost = (req.query.host || "") as string;
    const host = normalizeHost(rawHost);
    const email = String((req.query.email || "") as string) || undefined;

    if (!host) return res.status(404).json({ ok: false, error: "bad_host", detail: "Missing or invalid host" });

    const key = `classify:${clientKey(req)}`;
    const cap = CFG.classifyDailyLimit;
    const count = Number(daily.get(key) ?? 0);
    if (count >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    const ed = emailsDomain(email);
    if (ed && ed !== host && !ed.endsWith(`.${host}`)) { /* soft-allow */ }

    const result = await withCache(
      `class:${host}`,
      CFG.classifyCacheTtlS * 1000,
      () => classifyHostOnce(host)
    );

    if (typeof daily.inc === "function") daily.inc(key, 1);
    return res.json({ ...(result as object), cached: true });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    const friendly =
      /too-large/.test(msg) ? "site too large" :
      /status\s+4\d\d/.test(msg) ? "blocked or not found" :
      /fetch-failed|aborted|network/i.test(msg) ? "network error while reading your site." :
      msg;
    return res.status(200).json({ ok: false, error: "classify-failed", detail: friendly });
  }
});

r.post("/", async (req: Request, res: ExResponse) => {
  try {
    const body = (req.body || {}) as { host?: string; email?: string };
    const host = normalizeHost(body.host);
    if (!host) return res.status(404).json({ ok: false, error: "bad_host" });

    const key = `classify:${clientKey(req)}`;
    const cap = CFG.classifyDailyLimit;
    const count = Number(daily.get(key) ?? 0);
    if (count >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    const result = await withCache(
      `class:${host}`,
      CFG.classifyCacheTtlS * 1000,
      () => classifyHostOnce(host)
    );
    if (typeof daily.inc === "function") daily.inc(key, 1);
    return res.json({ ...(result as object), cached: true });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "classify-failed", detail: msg });
  }
});

export default r;