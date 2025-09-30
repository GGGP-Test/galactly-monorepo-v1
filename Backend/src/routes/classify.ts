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
//     hotMetrics?: string[],  // NEW: per-site, product/sector-aware hot-lead metrics
//     opsPool?: string[],     // NEW: buyer operations suitable for this supplier
//     bytes, fetchedAt, cached
//   }

import { Router, Request, Response as ExResponse } from "express";
import { withCache, daily } from "../shared/guards";
import { CFG } from "../shared/env";

/* --------------------------------- fetch ---------------------------------- */

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

/* -------------------------------- helpers --------------------------------- */

function normalizeHost(raw?: string): string | undefined {
  if (!raw) return undefined;
  const h = String(raw).trim().toLowerCase();
  const clean = h.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean || !/^[a-z0-9.-]+$/.test(clean)) return undefined;
  return clean;
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

async function timedFetch(url: string, timeoutMs: number): Promise<FetchResponse> {
  const ctl = new (globalThis as any).AbortController();
  const t = setTimeout(() => ctl.abort(), Math.max(100, timeoutMs));
  try {
    return await F(url, { signal: ctl.signal, redirect: "follow" });
  } finally {
    clearTimeout(t as any);
  }
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
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (!meta[k]) meta[k] = v;
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = meta["description"] || meta["og:description"] || undefined;

  const keywordsRaw = meta["keywords"];
  const keywords =
    keywordsRaw?.split(/[,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean) || undefined;

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

/* --------------------------- classification rules -------------------------- */

type Role = "packaging_supplier" | "packaging_buyer" | "neither";

function ruleClassify(text: string, jsonld: string[]): {
  role: Role;
  confidence: number;
  evidence: string[];
} {
  const t = text.toLowerCase();

  const productSignals = ["product", "catalog", "shop", "store", "price", "sku"];
  const packagingTokens = [
    "packaging","box","boxes","carton","cartons","corrugate","corrugated","label","labels",
    "tape","pouch","pouches","bottle","bottles","jar","jars","mailers","carton","film","shrink",
    "pallet","pallets","mailer"
  ];
  const buyerHints = ["brand", "retail", "ecommerce", "our stores", "locations", "menu"];
  const supplierVerbs = [
    "manufacture","manufacturer","supply","supplies","wholesale","distributor","converter",
    "co-pack","contract pack","private label","fabricate","produce"
  ];

  const contains = (arr: string[]) => arr.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);

  const prod = contains(productSignals);
  const pack = contains(packagingTokens);
  const buy  = contains(buyerHints);
  const sup  = contains(supplierVerbs);

  let scoreSupplier = sup + pack + (prod > 0 ? 1 : 0);
  let scoreBuyer    = buy + (prod > 0 ? 1 : 0);

  for (const raw of jsonld) {
    try {
      const obj = JSON.parse(raw);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const o of arr) {
        const s = String((o && (o["@type"] || o.type)) || "").toLowerCase();
        if (s.includes("wholesalestore") || s.includes("manufacturer") || s.includes("organization")) scoreSupplier += 1;
        if (s.includes("store") || s.includes("localbusiness") || s.includes("brand")) scoreBuyer += 1;
      }
    } catch { /* ignore bad LD */ }
  }

  const evidence: string[] = [];
  if (prod) evidence.push(`product_signals:${prod}`);
  if (pack) evidence.push(`packaging_terms:${pack}`);
  if (sup)  evidence.push(`supplier_verbs:${sup}`);
  if (buy)  evidence.push(`buyer_hints:${buy}`);

  if (scoreSupplier >= scoreBuyer && scoreSupplier >= 2)
    return { role: "packaging_supplier", confidence: Math.min(1, 0.55 + 0.1 * scoreSupplier), evidence };
  if (scoreBuyer >= 2)
    return { role: "packaging_buyer", confidence: Math.min(1, 0.55 + 0.1 * scoreBuyer), evidence };
  return { role: "neither", confidence: 0.35, evidence };
}

/* ------------------------------- lexicons ---------------------------------- */

const PRODUCT_LEX: Record<string, string[]> = {
  boxes: ["box","boxes","carton","cartons","rigid box","corrugated","mailer box","folding carton"],
  labels: ["label","labels","sticker","stickers"],
  cartons: ["carton","cartons"],
  pouches: ["pouch","pouches","stand up pouch","stand-up pouch","mylar","sachet"],
  bottles: ["bottle","bottles","vial","vials","jar","jars","closure","cap"],
  tape: ["tape","packaging tape"],
  corrugate: ["corrugate","corrugated","ect","mullen"],
  mailers: ["mailer","mailers","poly mailer","polybag","poly bag","mailer bag","mailer_bag"],
  pallets: ["pallet","pallets","palletize","palletising","palletizing"],
  shrink: ["shrink","shrink wrap","shrink film"],
  film: ["film","laminate","laminated film","stretch film","stretch wrap","ldpe","lldpe","coex"]
};

const SECTOR_LEX: Record<string, string[]> = {
  food: ["food","snack","sauce","salsa","candy","baked","meat","seafood","produce"],
  beverage: ["beverage","drink","juice","soda","coffee","tea","brewery","beer","wine"],
  cosmetics: ["cosmetic","cosmetics","beauty","skincare","skin care","haircare","makeup"],
  supplements: ["supplement","nutraceutical","vitamin","sports nutrition"],
  electronics: ["electronics","devices","gadgets","component","esd"],
  apparel: ["apparel","fashion","clothing","garment"],
  pharma: ["pharma","pharmaceutical","medical","medication","rx","gmp","lot traceability","coa"],
  pet: ["pet","pets","petcare","pet care"],
  automotive: ["automotive","auto","aftermarket"],
  home: ["home goods","home & garden","furniture","decor"],
  industrial: ["industrial","b2b","manufacturing","factory"],
  cannabis: ["cannabis","cbd","hemp"]
};

/* ---------------------------- scoring utilities ---------------------------- */

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function scoreLexicon(text: string, keywords?: string[]) {
  const t = text.toLowerCase();
  const kw = (keywords || []).join(" ").toLowerCase();
  return (lex: Record<string, string[]>) => {
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
  return Object.entries(scores).sort((a,b)=>b[1]-a[1]).slice(0, max).map(([k])=>k);
}

/* ----------------------- hot metrics & ops derivation ---------------------- */

function buildHotMetrics(products: string[], sectors: string[], text: string): string[] {
  const t = text.toLowerCase();
  const set = new Set<string>();

  const has = (word: RegExp | string) =>
    (typeof word === "string" ? t.includes(word.toLowerCase()) : word.test(t));

  const prod = (kw: string) => products.some(p => p.includes(kw));
  const sect = (kw: string) => sectors.some(s => s.includes(kw));

  // Stretch/shrink/pallet film
  if (prod("shrink") || prod("film") || prod("pallet") || has(/stretch|pallet|shrink/)) {
    set.add("Hand pallet wrapping");
    set.add("Automated pallet wrapper readiness");
    set.add("Load stability / puncture resistance");
    set.add("Gauge optimization vs break risk");
    set.add("Weekly pallet throughput");
    set.add("COF / cling requirements");
  }

  // Corrugated / boxes / cartons
  if (prod("boxes") || prod("carton") || prod("corrugate")) {
    set.add("ECT / stack strength at target weight");
    set.add("Board grade & burst/Mullen targets");
    set.add("Die-line, folding & glue integrity");
    set.add("Print registration & brand color accuracy");
    set.add("Damage reduction targets in transit");
  }

  // Labels
  if (prod("labels")) {
    set.add("Adhesive performance vs substrate & temperature");
    set.add("Print finish & brand color match");
    set.add("Regulatory label compliance (e.g., GHS/FDA)");
    set.add("Label application line readiness");
  }

  // Pouches / flexible film
  if (prod("pouches") || (prod("film") && has(/mvtr|otr|barrier|foil|laminate|seal/i))) {
    set.add("Barrier specs (OTR / MVTR)");
    set.add("Seal strength & leak rate targets");
    set.add("Shelf life & freshness targets");
  }

  // Bottles / jars
  if (prod("bottles")) {
    set.add("Breakage rate tolerance");
    set.add("Closure compatibility & torque");
    set.add("Label application alignment & adhesion");
  }

  // E-com / warehouse / 3PL
  if (has(/e-?com|fulfill|3pl|pick.?pack|distribution|warehouse/i)) {
    set.add("E-commerce fulfillment compatibility");
    set.add("3PL / distribution integration");
    set.add("Warehouse pick/pack flow");
    set.add("Parcel test pass rate (ISTA 3A/6)");
  }

  // Food / beverage / barrier / FDA
  if (sect("food") || sect("beverage") || has(/fda|usda|barrier|oxygen|moisture|foil|coa|lot/i)) {
    set.add("Food-contact compliance (FDA/EC)");
    set.add("Moisture / oxygen barrier needs");
    set.add("Lot traceability & COA");
  }

  // Pharma / medical
  if (sect("pharma") || has(/gmp|lot trace|serialization|medical|rx/i)) {
    set.add("GMP/lot traceability & serialization support");
    set.add("Tamper evidence / CR compliance");
  }

  // Cold chain
  if (has(/cold[- ]?chain|thermal|insulated|refrigerated|temperature/i)) {
    set.add("Thermal hold-time requirements");
  }

  // Sustainability (only if signals present)
  if (has(/recycl|pcr|post[- ]consumer|compost|bio|sustain/i)) {
    set.add("Sustainability targets (PCR %, recyclability)");
  }

  // Commercial
  set.add("Unit cost at target MOQ");

  return [...set];
}

function buildOpsPool(products: string[], sectors: string[], text: string): string[] {
  const t = text.toLowerCase();
  const set = new Set<string>();
  const has = (re: RegExp) => re.test(t);
  const prod = (kw: string) => products.some(p => p.includes(kw));
  const sect = (kw: string) => sectors.some(s => s.includes(kw));

  if (prod("shrink") || prod("film") || prod("pallet") || has(/stretch|pallet|shrink/)) {
    set.add("Hand pallet wrapping");
    set.add("Automated pallet wrapper");
  }

  if (has(/e-?com|fulfill|3pl|pick.?pack|warehouse|distribution/)) {
    set.add("E-commerce fulfillment");
    set.add("Warehouse pick/pack");
    set.add("3PL / distribution");
  }

  if (sect("food") || sect("beverage")) {
    // ops common to food/bev downstream
    set.add("Co-packing");
  }

  if (has(/cold[- ]?chain|thermal|insulated|refrigerated|temperature/)) {
    set.add("Cold-chain handling");
  }

  // Always allow co-packing if labels/boxes/pouches are strong
  if (prod("labels") || prod("boxes") || prod("pouches")) set.add("Co-packing");

  return [...set];
}

/* ------------------------------ composition -------------------------------- */

function composeOneLiner(
  host: string,
  role: Role,
  products: string[],
  sectors: string[],
  meta?: { title?: string; description?: string; }
) {
  const shortHost = host.replace(/^www\./, "");
  const verb =
    role === "packaging_buyer" ? "buys packaging" :
    role === "packaging_supplier" ? "sells packaging" : "does business";

  const prodBits = products.slice(0, 3).join(", ");
  const secBits = sectors.slice(0, 3).join(", ");

  const desc = meta?.description || meta?.title;
  if (desc && desc.length >= 40 && /packag/i.test(desc)) {
    const clean = desc.replace(/\s+/g, " ").trim();
    return clean.endsWith(".") ? clean : `${clean}.`;
  }

  let line = `${shortHost} ${verb}`;
  if (prodBits) line += ` — focus on ${prodBits}`;
  if (secBits) line += ` for ${secBits}`;
  line += ".";
  return line;
}

/* ------------------------------- classify ---------------------------------- */

async function classifyHostOnce(host: string) {
  const page = await fetchHomepage(host);
  const parsed = extractTextMeta(page.body);
  const first = ruleClassify(parsed.text, parsed.jsonld);

  const scorer = scoreLexicon(parsed.text, parsed.keywords);
  const productScores = scorer(PRODUCT_LEX);
  const sectorScores  = scorer(SECTOR_LEX);

  const productTags = topKeys(productScores, 12);
  const sectorHints = topKeys(sectorScores, 8);

  const summary = composeOneLiner(
    host, first.role, productTags, sectorHints,
    { title: parsed.title, description: parsed.description }
  );

  // Build server-side hot metrics + ops pool (preferred by UI if present)
  const hotMetrics = buildHotMetrics(productTags, sectorHints, parsed.text);
  const opsPool    = buildOpsPool(productTags, sectorHints, parsed.text);

  return {
    ok: true,
    host,
    role: first.role,
    confidence: first.confidence,
    summary,
    productTags,
    sectorHints,
    evidence: first.evidence,
    hotMetrics,
    opsPool,
    bytes: page.bytes,
    fetchedAt: new Date().toISOString(),
    cached: false
  };
}

/* ---------------------------------- routes --------------------------------- */

r.get("/", async (req: Request, res: ExResponse) => {
  try {
    const rawHost = (req.query.host || "") as string;
    const host = normalizeHost(rawHost);
    const email = String((req.query.email || "") as string) || undefined;

    if (!host) return res.status(404).json({ ok: false, error: "bad_host", detail: "Missing or invalid host" });

    // daily limit
    const key = `classify:${clientKey(req)}`;
    const cap = CFG.classifyDailyLimit;
    const count = Number(daily.get(key) ?? 0);
    if (count >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    // soft email↔domain check (informational only)
    const ed = emailsDomain(email);
    if (ed && ed !== host && !ed.endsWith(`.${host}`)) {
      // could lower confidence later if we want
    }

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