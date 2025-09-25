import { Router, Request, Response } from "express";

let pool: any = null;
try {
  // canonical, single db path — do not change
  pool = require("../shared/db").pool;
} catch { /* optional DB; mem fallback handles locks */ }

const router = Router();

/* ---------------- Types + in-mem fallback for lock() ---------------- */
type Temp = "warm" | "hot";
type Lead = {
  host: string;
  platform?: string;
  title: string;
  created: string;
  temp: Temp;
  why?: string;
  supplier_host?: string;
};
const lockedMem = new Map<string, { lead: Lead; at: number }>();
const TTL_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of lockedMem) if (now - v.at > TTL_MS) lockedMem.delete(k);
}, 10 * 60 * 1000);

/* ---------------- Small utils (no regex flags) ---------------- */
function normHost(input: string): string {
  let s = (input || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    let h = (u.hostname || "").toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    let h = (input || "").trim().toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  }
}

/* ---------------- Vertical detection from supplier host ---------------- */
type Vertical = "CPG" | "Food" | "Beverage" | "Beauty" | "Household" | "Retail" | "Apparel" | "Pet";

function guessVertical(supplierHost: string): Vertical[] {
  const s = supplierHost.toLowerCase();

  // Packaging keyword hints → vertical weighting
  const kwFood = ["snack","food","pouch","bag","bake","sauce","meal","frozen","deli","jerky","bar","granola","chips","cookie","soup","cereal"];
  const kwBev  = ["brew","coffee","tea","drink","bev","soda","water","can","bottle","sleeve","shrink","stretch","film"];
  const kwBeauty = ["beauty","cosmetic","skincare","lotion","serum","tube","jar","dropper"];
  const kwHH = ["home","clean","detergent","laundry","dish","wipes","trash","foil","wrap","liner","canister"];
  const kwPet = ["pet","dog","cat","treats","kibble","litter"];
  const kwRetail = ["market","grocer","foods","pharmacy","retail","store"];

  const tags: Vertical[] = ["CPG"];
  const has = (arr: string[]) => arr.some(w => s.includes(w));

  if (has(kwBev)) tags.unshift("Beverage");
  if (has(kwFood) || s.includes("flex") || s.includes("corrug") || s.includes("carton")) tags.unshift("Food");
  if (has(kwBeauty)) tags.unshift("Beauty");
  if (has(kwHH) || s.includes("house")) tags.unshift("Household");
  if (has(kwPet)) tags.unshift("Pet");
  if (has(kwRetail)) tags.unshift("Retail");

  // stretch/shrink/film → often Bev/Food private label
  if (s.includes("stretch") || s.includes("shrink") || s.includes("film") || s.includes("wrap")) {
    if (!tags.includes("Beverage")) tags.unshift("Beverage");
    if (!tags.includes("Food")) tags.unshift("Food");
    if (!tags.includes("Retail")) tags.push("Retail");
  }

  return Array.from(new Set(tags));
}

/* ---------------- Seed pools (expanded US/CA coverage) ---------------- */
type Buyer = { host: string; pages: { path: string; title: string }[]; tier: "A" | "B"; vertical: Vertical; region: "US" | "CA" | "NA" };

const BUYERS_AB: Buyer[] = [
  // Major US Food/Beverage/Household (Tier A)
  { host: "coca-colacompany.com", tier: "A", vertical: "Beverage", region: "US", pages: [{ path: "/suppliers", title: "Suppliers | The Coca-Cola Company" }] },
  { host: "pepsico.com",           tier: "A", vertical: "Beverage", region: "US", pages: [{ path: "/suppliers", title: "Supplier portal | PepsiCo" }] },
  { host: "keurigdrpepper.com",    tier: "A", vertical: "Beverage", region: "US", pages: [{ path: "/procurement", title: "Procurement | Keurig Dr Pepper" }] },
  { host: "nestle.com",            tier: "A", vertical: "Food",     region: "NA", pages: [{ path: "/suppliers", title: "Suppliers | Nestlé" }] },
  { host: "generalmills.com",      tier: "A", vertical: "Food",     region: "US", pages: [{ path: "/suppliers", title: "Suppliers | General Mills" }] },
  { host: "kraftheinzcompany.com", tier: "A", vertical: "Food",     region: "US", pages: [{ path: "/procurement", title: "Procurement | Kraft Heinz" }] },
  { host: "mondelezinternational.com", tier: "A", vertical: "Food", region: "US", pages: [{ path: "/suppliers", title: "Suppliers | Mondelēz" }] },
  { host: "conagra.com",           tier: "A", vertical: "Food",     region: "US", pages: [{ path: "/suppliers", title: "Suppliers | Conagra" }] },
  { host: "kellanova.com",         tier: "A", vertical: "Food",     region: "US", pages: [{ path: "/partners", title: "Partners | Kellanova (Kellogg’s)" }] },
  { host: "campbellsoupcompany.com", tier: "B", vertical: "Food",   region: "US", pages: [{ path: "/suppliers", title: "Suppliers | Campbell Soup" }] },
  { host: "hormelfoods.com",       tier: "A", vertical: "Food",     region: "US", pages: [{ path: "/supplier", title: "Supplier / vendor info | Hormel Foods" }] },
  { host: "tysonfoods.com",        tier: "A", vertical: "Food",     region: "US", pages: [{ path: "/suppliers", title: "Suppliers | Tyson Foods" }] },
  // Household / Beauty
  { host: "clorox.com",            tier: "A", vertical: "Household", region: "US", pages: [{ path: "/suppliers", title: "Suppliers & procurement | Clorox" }] },
  { host: "pg.com",                tier: "A", vertical: "Household", region: "US", pages: [{ path: "/suppliers", title: "Suppliers | P&G" }] },
  { host: "kimberly-clark.com",    tier: "A", vertical: "Household", region: "US", pages: [{ path: "/procurement", title: "Procurement | Kimberly-Clark" }] },
  { host: "unilever.com",          tier: "A", vertical: "Beauty",    region: "NA", pages: [{ path: "/suppliers", title: "Suppliers | Unilever" }] },
  { host: "colgatepalmolive.com",  tier: "A", vertical: "Household", region: "US", pages: [{ path: "/partners", title: "Partners | Colgate-Palmolive" }] },
  // Retail US (private label buyers)
  { host: "walmart.com",           tier: "A", vertical: "Retail",    region: "US", pages: [{ path: "/supplier", title: "Suppliers | Walmart" }] },
  { host: "target.com",            tier: "A", vertical: "Retail",    region: "US", pages: [{ path: "/partners", title: "Partners | Target" }] },
  { host: "costco.com",            tier: "A", vertical: "Retail",    region: "US", pages: [{ path: "/suppliers", title: "Suppliers | Costco (Kirkland)" }] },
  { host: "albertsons.com",        tier: "B", vertical: "Retail",    region: "US", pages: [{ path: "/suppliers", title: "Suppliers | Albertsons" }] },
  { host: "kroger.com",            tier: "A", vertical: "Retail",    region: "US", pages: [{ path: "/suppliers", title: "Suppliers | Kroger" }] },
  { host: "wholefoodsmarket.com",  tier: "B", vertical: "Retail",    region: "US", pages: [{ path: "/suppliers", title: "Suppliers | Whole Foods" }] },
  { host: "traderjoes.com",        tier: "B", vertical: "Retail",    region: "US", pages: [{ path: "/partners", title: "Partners | Trader Joe’s" }] },
  // Pet
  { host: "purina.com",            tier: "A", vertical: "Pet",       region: "US", pages: [{ path: "/suppliers", title: "Suppliers | Purina" }] },
  { host: "bluebuffalo.com",       tier: "B", vertical: "Pet",       region: "US", pages: [{ path: "/partners", title: "Partners | Blue Buffalo" }] },
  // Canada key buyers
  { host: "loblaw.ca",             tier: "A", vertical: "Retail",    region: "CA", pages: [{ path: "/suppliers", title: "Suppliers | Loblaw" }] },
  { host: "metro.ca",              tier: "B", vertical: "Retail",    region: "CA", pages: [{ path: "/suppliers", title: "Suppliers | Metro" }] },
  { host: "sobeys.com",            tier: "B", vertical: "Retail",    region: "CA", pages: [{ path: "/suppliers", title: "Suppliers | Sobeys" }] },
];

/* Tier-C micro/indie brands — good packaging spenders */
type MicroBuyer = { host: string; title: string; vertical: Vertical; region: "US" | "CA" | "NA" };
const BUYERS_C: MicroBuyer[] = [
  { host: "liquiddeath.com",  title: "Partnerships & operations", vertical: "Beverage", region: "US" },
  { host: "olipop.com",       title: "Partnerships & sourcing",   vertical: "Beverage", region: "US" },
  { host: "poppi.co",         title: "Vendor / sourcing",         vertical: "Beverage", region: "US" },
  { host: "guayaki.com",      title: "Supplier / partner",        vertical: "Beverage", region: "US" },
  { host: "huel.com",         title: "Supply & packaging",        vertical: "Food",     region: "NA" },
  { host: "lesserevil.com",   title: "Packaging & operations",    vertical: "Food",     region: "US" },
  { host: "hippeas.com",      title: "Vendor / sourcing",         vertical: "Food",     region: "US" },
  { host: "drunkelephant.com",title: "Packaging & sourcing",      vertical: "Beauty",   region: "US" },
  { host: "iliabeauty.com",   title: "Supplier / operations",     vertical: "Beauty",   region: "US" },
  { host: "methodhome.com",   title: "Packaging & logistics",     vertical: "Household",region: "US" },
  { host: "blueland.com",     title: "Operations / vendor",       vertical: "Household",region: "US" },
  { host: "thefarmersdog.com",title: "Operations / packaging",    vertical: "Pet",      region: "US" },
  { host: "sprouts.com",      title: "Own brand packaging",       vertical: "Retail",   region: "US" },
  { host: "wegmans.com",      title: "Private label packaging",   vertical: "Retail",   region: "US" },
  { host: "heb.com",          title: "Own brand packaging",       vertical: "Retail",   region: "US" },
  { host: "londondrugs.com",  title: "Private label packaging",   vertical: "Retail",   region: "CA" },
];

/* ---------------- Selection logic with robust fallbacks ---------------- */
type Region = "US" | "CA" | "NA";
function normalizeRegion(q: string | undefined): Region {
  const s = (q || "").toUpperCase();
  if (s.includes("CA") && !s.includes("USA")) return "CA";
  return "US"; // default for Free Panel UI
}

function pickBuyer(
  supplierHost: string,
  opts: { tier?: "A" | "B" | "C"; depth?: "shallow" | "deep"; region: Region }
): { host: string; title: string; why: string } {
  const sup = normHost(supplierHost);
  const wantedTier = opts.tier;
  const deep = opts.depth === "deep";
  const region = opts.region;
  const verticalPref = guessVertical(supplierHost);

  // Build filtered pools (region + supplier exclusion)
  const abBase = BUYERS_AB.filter(b => b.host !== sup && (b.region === region || b.region === "NA"));
  const cBase  = BUYERS_C.filter(b => b.host !== sup && (b.region === region || b.region === "NA"));

  // Try: vertical-matched Tier request
  let abPool = abBase.filter(b => (!wantedTier || b.tier === wantedTier) && verticalPref.includes(b.vertical));
  let cPool  = cBase.filter(b => verticalPref.includes(b.vertical));

  // If empty due to vertical mismatch, relax vertical filter
  if (!abPool.length) abPool = abBase.filter(b => !wantedTier || b.tier === wantedTier);
  if (!cPool.length)  cPool  = cBase;

  // Priority: explicit Tier; else A/B then (if deep) C; else C as last resort
  if (wantedTier === "C") {
    const chosen = cPool[Math.floor(Math.random() * Math.min(cPool.length, 8))] || cBase[0];
    return {
      host: chosen.host,
      title: chosen.title,
      why: `Tier C ${chosen.vertical}; ${region} indie/retail (supplier: ${sup})`
    };
  }

  if (abPool.length) {
    // bias to Tier A
    abPool.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "A" ? -1 : 1));
    const chosen = abPool[Math.floor(Math.random() * Math.min(abPool.length, 10))];
    const page = chosen.pages[0];
    return {
      host: chosen.host,
      title: page?.title || "Supplier / vendor program",
      why: `Tier ${chosen.tier} ${chosen.vertical}; ${region} supplier program (picked for supplier: ${sup})`
    };
  }

  if (deep || !abPool.length) {
    const chosen = cPool[Math.floor(Math.random() * Math.min(cPool.length, 10))] || cBase[0];
    return {
      host: chosen.host,
      title: chosen.title,
      why: `Tier C ${chosen.vertical}; ${region} partnerships (supplier: ${sup})`
    };
  }

  // Absolute last guard: pick any AB excluding supplier
  const any = abBase[0] || { host: "sprouts.com", vertical: "Retail", pages: [{ path: "/brand", title: "Own brand packaging" }], tier: "B" as const, region: "US" as const };
  return {
    host: any.host,
    title: any.pages[0].title,
    why: `Generic fallback; ${region} AB buyer (supplier: ${sup})`
  };
}

/* ---------------- API: find-buyers (always returns a candidate) ---------------- */
router.get("/leads/find-buyers", (req: Request, res: Response) => {
  const supplier = String(req.query.host || "").trim();
  if (!supplier) return res.status(400).json({ error: "host is required" });

  const tierQ = String(req.query.tier || "").toUpperCase();
  const tier: "A" | "B" | "C" | undefined =
    tierQ === "A" || tierQ === "B" || tierQ === "C" ? (tierQ as any) : undefined;

  const depthQ = String(req.query.depth || "").toLowerCase();
  const depth: "shallow" | "deep" = depthQ === "shallow" ? "shallow" : "deep"; // default to deep

  const region = normalizeRegion(String(req.query.region || ""));

  const picked = pickBuyer(supplier, { tier, depth, region });

  // Ensure we never echo the supplier back
  if (normHost(picked.host) === normHost(supplier)) {
    // pick again with hard fallback
    const alt = pickBuyer("example.com", { tier, depth: "deep", region });
    return res.json({
      host: alt.host,
      platform: "web",
      title: alt.title,
      created: new Date().toISOString(),
      temp: "warm" as const,
      why: alt.why,
      supplier_host: normHost(supplier),
    });
  }

  return res.json({
    host: picked.host,
    platform: "web",
    title: picked.title || `Buyer lead`,
    created: new Date().toISOString(),
    temp: "warm" as const,
    why: picked.why,
    supplier_host: normHost(supplier),
  });
});

/* ---------------- API: lock (unchanged semantics) ---------------- */
router.post("/leads/lock", async (req: Request, res: Response) => {
  const body = req.body || {};
  const host = normHost(body.host || "");
  const title = String(body.title || "").trim();
  const temp: Temp = body.temp === "hot" ? "hot" : "warm";
  const created = body.created && typeof body.created === "string" ? body.created : new Date().toISOString();
  const why = String(body.why || "");
  const supplier_host = normHost(body.supplier_host || "");

  if (!host || !title) return res.status(400).json({ error: "candidate with host and title required" });
  if (host === supplier_host) return res.status(409).json({ error: "cannot lock supplier itself" });

  const lead: Lead = { host, title, temp, created, why, supplier_host, platform: "web" };

  try {
    if (pool) {
      await pool.query(
        `insert into leads (host, title, temp, created, why, supplier_host)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (host, title) do update set temp=excluded.temp, created=excluded.created, why=excluded.why`,
        [host, title, temp, created, why, supplier_host]
      );
    } else {
      const key = host + "•" + title;
      lockedMem.set(key, { lead, at: Date.now() });
    }
  } catch {
    const key = host + "•" + title;
    lockedMem.set(key, { lead, at: Date.now() });
  }

  return res.status(200).json({ ok: true });
});

export default router;