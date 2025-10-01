// src/routes/classify.ts
//
// Domain classifier with guardrails + caching + lightweight enrichment.
// GET  /api/classify?host=acme.com&email=user@acme.com
// POST /api/classify  { host, email }
//
// Returns (success):
//   {
//     ok: true,
//     host, role, confidence, summary,
//     productTags: string[],
//     sectorHints: string[],
//     evidence: string[],
//     hotMetricsBySector?: Record<string,string[]>,
//     geoHints?: { citiesTop: string[], statesTop: string[] },
//     bytes, fetchedAt, cached
//   }

import { Router, Request, Response as ExResponse } from "express";
import { withCache } from "../shared/guards";
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

async function timedFetch(url: string, timeoutMs: number): Promise<FetchResponse> {
  const ctl = new (globalThis as any).AbortController();
  const t = setTimeout(() => ctl.abort(), Math.max(100, timeoutMs));
  try { return await F(url, { signal: ctl.signal, redirect: "follow" }); }
  finally { clearTimeout(t as any); }
}

async function fetchHomepage(host: string): Promise<{ body: string; bytes: number; finalUrl: string }> {
  const urls = [`https://${host}/`, `http://${host}/`];
  let lastErr: unknown;
  for (const u of urls) {
    try {
      const res = await timedFetch(u, CFG.fetchTimeoutMs);
      if (!res.ok) { lastErr = new Error(`status ${res.status}`); continue; }
      const buf = await res.arrayBuffer();
      const bytes = buf.byteLength;
      if (bytes > CFG.maxFetchBytes) throw new Error(`too-large:${bytes}`);
      const body = new TextDecoder("utf-8").decode(buf);
      return { body, bytes, finalUrl: res.url || u };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("fetch-failed");
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
  const title = titleMatch?.[1]?.trim();
  const description = meta["description"] || meta["og:description"] || undefined;

  const keywordsRaw = meta["keywords"];
  const keywords = keywordsRaw?.split(/[,;]|·/).map(s=>s.trim().toLowerCase()).filter(Boolean) || undefined;

  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 200000)
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

// ---- rule classification (simple + deterministic) ---------------------------
type Role = "packaging_supplier" | "packaging_buyer" | "neither";

function ruleClassify(text: string, jsonld: string[]): {
  role: Role;
  confidence: number;
  evidence: string[];
} {
  const t = text.toLowerCase();

  const productSignals = ["product", "catalog", "shop", "store", "price", "cart", "sku"];
  const packagingTokens = [
    "packaging","box","boxes","carton","cartons","corrugate","corrugated",
    "label","labels","tape","pouch","pouches","bottle","bottles","jar","jars",
    "mailers","mailer","film","shrink","pallet","pallets","clamshell","blister"
  ];
  const buyerHints = ["brand", "retail", "ecommerce", "our stores", "locations", "menu"];
  const supplierVerbs = ["manufacture", "supply", "wholesale", "distributor", "converter", "co-pack", "contract pack", "private label"];

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
    } catch { /* ignore bad JSON-LD */ }
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
  pouches: ["pouch","pouches","stand up pouch","stand-up pouch","mylar"],
  bottles: ["bottle","bottles","vial","vials"],
  jars: ["jar","jars","tin","tins"],
  tape: ["tape","packaging tape"],
  corrugate: ["corrugate","corrugated"],
  mailers: ["mailer","mailers","poly mailer"],
  clamshells: ["clamshell","clamshells","blister"],
  foam: ["foam insert","foam","eva foam"],
  pallets: ["pallet","pallets","palletizing"],
  mailer_bags: ["bag","bags","polybag","poly bag"],
  shrink: ["shrink","shrink wrap","shrink film"],
  film: ["film","flexible film","laminate","laminated film"]
};

const SECTOR_LEX: Record<string, string[]> = {
  food: ["food","grocery","snack","sauce","salsa","candy","baked"],
  beverage: ["beverage","drink","juice","soda","coffee","tea","brewery","beer","wine","distillery"],
  cosmetics: ["cosmetic","cosmetics","beauty","skincare","skin care","haircare","makeup","fragrance"],
  supplements: ["supplement","nutraceutical","vitamin","sports nutrition"],
  electronics: ["electronics","devices","gadgets","semiconductor","pcb"],
  apparel: ["apparel","fashion","clothing","garment"],
  pharma: ["pharma","pharmaceutical","medical","medication","rx","otc"],
  pet: ["pet","pets","petcare","pet care"],
  automotive: ["automotive","auto","aftermarket"],
  home: ["home goods","home & garden","furniture","decor"],
  industrial: ["industrial","b2b","manufacturing","factory"],
  cannabis: ["cannabis","cbd","hemp"]
};

// sector → curated hot metrics
function suggestSectorMetrics(productTags: string[], sectorHints: string[]): Record<string,string[]> {
  const has = (arr: string[], w: string) => arr.some(x => x.toLowerCase() === w.toLowerCase());
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

// quick geo hints: City, ST  / City, State
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

// concise line
function composeOneLiner(host: string, role: Role, products: string[], sectors: string[], meta?: { title?: string; description?: string; }) {
  const shortHost = host.replace(/^www\./, "");
  const verb = role === "packaging_buyer" ? "buys packaging" :
               role === "packaging_supplier" ? "sells packaging" : "does business";
  const prodBits = products.slice(0, 2).join(", ");
  const secBits = sectors.slice(0, 2).join(" & ");
  let line = `${shortHost} ${verb}`;
  if (prodBits) line += ` — focus on ${prodBits}`;
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
  const page = await fetchHomepage(host);
  const parsed = extractTextMeta(page.body);
  const first = ruleClassify(parsed.text, parsed.jsonld);

  const scorer = scoreLexicon(parsed.text, parsed.keywords);
  const productScores = scorer(PRODUCT_LEX);
  const sectorScores = scorer(SECTOR_LEX);
  const productTags = topKeys(productScores, 12);
  const sectorHints = topKeys(sectorScores, 8);

  const summary = composeOneLiner(
    host,
    first.role,
    productTags,
    sectorHints,
    { title: parsed.title, description: parsed.description }
  );

  const hotMetricsBySector = suggestSectorMetrics(productTags, sectorHints);
  const geoHints = extractGeoHints(parsed.text);

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
    bytes: page.bytes,
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

    const ed = emailsDomain(email);
    if (ed && ed !== host && !ed.endsWith(`.${host}`)) { /* soft-allow */ }

    const result = await withCache(
      `class:${host}`,
      CFG.classifyCacheTtlS * 1000,
      () => classifyHostOnce(host)
    );

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

    const result = await withCache(
      `class:${host}`,
      CFG.classifyCacheTtlS * 1000,
      () => classifyHostOnce(host)
    );
    return res.json({ ...(result as object), cached: true });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "classify-failed", detail: msg });
  }
});

export default r;