// src/routes/classify.ts
//
// Hardened domain classifier:
// - Multi-page probing (/, /products, /solutions, /packaging, …) with real UA
// - Conservative time/byte limits
// - Expanded product lexicon for packaging giants
// - 1–3 items then “etc.” rule for products & sectors in one-liner
//
// GET  /api/classify?host=acme.com&email=user@acme.com
// POST /api/classify  { host, email }

import { Router, Request, Response as ExResponse } from "express";
import { withCache, daily } from "../shared/guards";
import { CFG } from "../shared/env";

// ---- minimal fetch typing (Node 20) -----------------------------------------
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

// ---- helpers ----------------------------------------------------------------
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
  const t = setTimeout(() => ctl.abort(), Math.max(200, timeoutMs));
  try { return await F(url, { signal: ctl.signal, redirect: "follow", headers: UA_HEADERS }); }
  finally { clearTimeout(t as any); }
}

function decodeUTF8(ab: ArrayBuffer): string {
  try { return new TextDecoder("utf-8").decode(ab); }
  catch { try { return new TextDecoder().decode(ab); } catch { return ""; } }
}

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

/** Choose next URLs to try when root is thin. */
function candidatePaths(host: string): string[] {
  const h = host.replace(/^www\./, "");
  const bases = [`https://${h}`, `https://www.${h}`, `http://${h}`];
  const tails = ["", "/", "/products", "/solutions", "/packaging", "/what-we-do", "/capabilities", "/markets", "/about"];
  const urls: string[] = [];
  for (const b of bases) for (const t of tails) urls.push(`${b}${t}`);
  return uniq(urls);
}

/** Fetch up to N pages until we have enough text. */
async function fetchMulti(host: string, maxPages = 3): Promise<{ text: string; jsonld: string[]; title?: string; description?: string; bytes: number; pagesTried: number[]; }> {
  const urls = candidatePaths(host);
  const jsonldAll: string[] = [];
  let textAll = "";
  let title: string | undefined;
  let description: string | undefined;
  let bytesTotal = 0;
  const tried: number[] = [];

  for (const url of urls) {
    if (tried.length >= maxPages) break;

    try {
      const res = await timedFetch(url, CFG.fetchTimeoutMs);
      if (!res.ok) continue;

      const buf = await res.arrayBuffer();
      const bytes = buf.byteLength;
      if (bytes > CFG.maxFetchBytes) continue; // skip giant HTML blobs
      bytesTotal += bytes;
      tried.push(res.status);

      const html = decodeUTF8(buf);
      const parsed = extractTextMeta(html);

      if (!title && parsed.title) title = parsed.title;
      if (!description && parsed.description) description = parsed.description;

      textAll += " \n " + parsed.text;
      jsonldAll.push(...parsed.jsonld);

      // Stop early when we have enough raw signal (rough heuristic)
      if (textAll.length > 8000) break;
    } catch {
      // ignore and move on
    }
  }

  return {
    text: textAll.trim(),
    jsonld: jsonldAll,
    title,
    description,
    bytes: bytesTotal,
    pagesTried: tried,
  };
}

// very light HTML -> text + JSON-LD + key meta
function extractTextMeta(html: string): {
  text: string;
  jsonld: string[];
  title?: string;
  description?: string;
  keywords?: string[];
} {
  const meta: Record<string, string> = {};
  const reMeta = /<meta\s+[^>]*?(?:name|property)\s*=\s*["']([^"']+)["'][^>]*?content\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = reMeta.exec(html))) {
    const k = m[1].toLowerCase(); const v = m[2].trim();
    meta[k] = meta[k] || v;
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim();
  const description = (meta["description"] || meta["og:description"] || meta["twitter:description"] || "").trim();

  const keywordsRaw = meta["keywords"];
  const keywords = keywordsRaw?.split(/[,;]|·/).map(s=>s.trim().toLowerCase()).filter(Boolean) || undefined;

  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 250000)
    .trim();

  const jsonld: string[] = [];
  const reLD = /<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
  let ml: RegExpExecArray | null;
  while ((ml = reLD.exec(html))) {
    const payload = ml[1]?.trim();
    if (payload) jsonld.push(payload);
  }

  return { text, jsonld, title, description, keywords };
}

// ---- rule classification ----------------------------------------------------
type Role = "packaging_supplier" | "packaging_buyer" | "neither";

function ruleClassify(text: string, jsonld: string[]): {
  role: Role;
  confidence: number;
  evidence: string[];
} {
  const t = (text || "").toLowerCase();

  const productSignals = ["product", "catalog", "shop", "store", "price", "cart", "sku"];
  const packagingTokens = [
    "packaging","package","packages","box","boxes","carton","cartons","corrugate","corrugated",
    "label","labels","tape","pouch","pouches","pouching","bottle","bottles","jar","jars",
    "mailers","mailer","film","shrink","stretch","pallet","pallets","thermoform","blister",
    "tray","trays","cup","cups","lid","lids","closure","closures","cap","caps","rigid","flexible"
  ];
  const buyerHints = ["brand", "retail", "ecommerce", "our stores", "locations", "menu"];
  const supplierVerbs = ["manufacture", "converter", "convert", "supply", "supplier", "wholesale", "distributor", "co-pack", "contract pack", "private label"];

  const contains = (arr: string[]) => arr.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);

  const prod = contains(productSignals);
  const pack = contains(packagingTokens);
  const buy = contains(buyerHints);
  const sup = contains(supplierVerbs);

  let scoreSupplier = sup + pack + (prod > 0 ? 1 : 0);
  let scoreBuyer = buy + (prod > 0 ? 1 : 0);

  // JSON-LD nudges
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

// ---- enrichment lexicons ----------------------------------------------------
const PRODUCT_LEX: Record<string, string[]> = {
  boxes: ["box","boxes","carton","cartons","rigid box","corrugated","mailer box"],
  labels: ["label","labels","sticker","stickers"],
  cartons: ["carton","cartons","folding carton"],
  pouches: ["pouch","pouches","stand up pouch","stand-up pouch","mylar","sachet","sachets"],
  bottles: ["bottle","bottles","vial","vials"],
  jars: ["jar","jars","tin","tins"],
  tape: ["tape","packaging tape"],
  corrugate: ["corrugate","corrugated"],
  mailers: ["mailer","mailers","poly mailer","mailer bag","polybag","poly bag"],
  clamshells: ["clamshell","clamshells","blister"],
  foam: ["foam insert","foam","eva foam"],
  pallets: ["pallet","pallets","palletizing","pallet wrap"],
  shrink: ["shrink","shrink wrap","shrink film"],
  film: ["film","flexible film","laminate","laminated film","flexible packaging","flexible"],
  closures: ["closure","closures","cap","caps","lids","lid","fitment","fitments"],
  trays: ["tray","trays","thermoform","thermoformed","thermoforming"],
  rigid: ["rigid","rigid packaging","tub","tubs","cup","cups","container","containers"]
};

const SECTOR_LEX: Record<string, string[]> = {
  food: ["food","grocery","snack","sauce","salsa","candy","baked","meals","ready meal"],
  beverage: ["beverage","drink","juice","soda","coffee","tea","brewery","beer","wine","distillery","dairy","water"],
  cosmetics: ["cosmetic","cosmetics","beauty","skincare","skin care","haircare","makeup","fragrance","personal care","home care"],
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

// sector → curated hot metrics
function suggestSectorMetrics(productTags: string[], sectorHints: string[]): Record<string,string[]> {
  const s = sectorHints.map(x=>x.toLowerCase());
  const p = productTags.map(x=>x.toLowerCase());
  const out: Record<string,string[]> = {};

  if (p.includes("boxes") || p.includes("cartons") || p.includes("corrugate")) {
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

// quick geo hints
const US_ST_ABBR = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const US_ST_FULL = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];

function extractGeoHints(text: string): { citiesTop: string[]; statesTop: string[] } {
  const t = text || "";
  const cities = new Map<string, number>();
  const states = new Map<string, number>();

  const reCitySt = /\b([A-Z][A-Za-z .'-]{2,}?),\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/g;
  let m: RegExpExecArray | null;
  while ((m = reCitySt.exec(t))) {
    const city = m[1].trim();
    const st = m[2].trim();
    cities.set(city, (cities.get(city) || 0) + 2);
    states.set(st, (states.get(st) || 0) + 2);
  }

  const reCityState = new RegExp(`\\b([A-Z][A-Za-z .'-]{2,}?),\\s*(${US_ST_FULL.join("|")})\\b`, "g");
  let n: RegExpExecArray | null;
  while ((n = reCityState.exec(t))) {
    const city = n[1].trim();
    const st = n[2].trim();
    cities.set(city, (cities.get(city) || 0) + 1);
    states.set(st, (states.get(st) || 0) + 1);
  }

  const citiesTop = Array.from(cities.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k);
  const statesTop = Array.from(states.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k);
  return { citiesTop, statesTop };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function joinForLine(list: string[]): string {
  const a = list.filter(Boolean);
  if (!a.length) return "";
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} & ${a[1]}`;
  if (a.length === 3) return `${a[0]}, ${a[1]} & ${a[2]}`;
  return `${a[0]}, ${a[1]}, ${a[2]}, etc.`;
}

// concise line (uses 1–3 items then etc.)
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

// ---- core classify ----------------------------------------------------------
async function classifyHostOnce(host: string) {
  const sample = await fetchMulti(host, 3);

  // If we got nearly nothing, be explicit
  if (!sample.text || sample.text.length < 500) {
    return {
      ok: true,
      host,
      role: "neither",
      confidence: 0.3,
      summary: `${host.replace(/^www\./,"")} does business.`,
      productTags: [],
      sectorHints: ["general"],
      evidence: ["thin_site_or_blocked"],
      hotMetricsBySector: suggestSectorMetrics([], ["general"]),
      geoHints: { citiesTop: [], statesTop: [] },
      bytes: sample.bytes,
      fetchedAt: new Date().toISOString(),
      cached: false
    };
  }

  const first = ruleClassify(sample.text, sample.jsonld);

  const scorer = scoreLexicon(sample.text);
  const productScores = scorer(PRODUCT_LEX);
  const sectorScores = scorer(SECTOR_LEX);
  let productTags = topKeys(productScores, 12);
  const sectorHints = topKeys(sectorScores, 8);

  // gentle fallback: if we saw “packag” but no tags, add generic “packaging”
  if (!productTags.length && /packag/i.test(sample.text)) {
    productTags = ["packaging"];
  }

  const summary = composeOneLiner(
    host,
    first.role,
    productTags,
    sectorHints.map(s => s.replace(/\b\w/g, m => m.toUpperCase())),
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
    cached: false
  };
}

// ---- routes -----------------------------------------------------------------
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