import { Router, Request, Response } from "express";

let pool: any = null;
try {
  // Single canonical DB path – do not change
  pool = require("../shared/db").pool;
} catch { /* optional at runtime; in-mem fallback below */ }

const router = Router();

/* ---------------- Types + tiny in-mem lock fallback ---------------- */
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

/* ---------------- Utilities (no regex flags) ---------------- */
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

type Region = "US" | "CA" | "NA";
function normalizeRegion(q: string | undefined): Region {
  const s = (q || "").toUpperCase();
  if (s.includes("CA") && !s.includes("USA")) return "CA";
  return "US";
}

type Vertical = "CPG" | "Food" | "Beverage" | "Beauty" | "Household" | "Retail" | "Pet";

/** Packaging keyword hints (from supplier domain) → vertical(s) + packaging tag */
function inferFromSupplier(host: string): { verticals: Vertical[]; ptag: string } {
  const s = host.toLowerCase();

  const has = (xs: string[]) => xs.some(w => s.includes(w));
  const vset = new Set<Vertical>(["CPG"]);

  // packaging tokens
  let ptag = "general packaging";
  if (has(["stretch","shrink","film","sleeve","wrap"])) { vset.add("Beverage"); vset.add("Food"); vset.add("Retail"); ptag = "stretch/shrink film"; }
  if (has(["label","labels","sticker"])) { vset.add("Beverage"); vset.add("Beauty"); ptag = "labels & sleeves"; }
  if (has(["bottle","glass","can","jar"])) { vset.add("Beverage"); vset.add("Beauty"); ptag = "bottles, cans & jars"; }
  if (has(["pouch","sachet","bag"])) { vset.add("Food"); vset.add("Pet"); ptag = "flexible pouches/bags"; }
  if (has(["corrug","carton","box"])) { vset.add("Food"); vset.add("Retail"); ptag = "corrugated/cartons"; }
  if (has(["thermoform","clamshell","tray","blister"])) { vset.add("Food"); vset.add("Beauty"); ptag = "thermoform/blister"; }
  if (has(["home","clean","detergent","laundry","wipe"])) { vset.add("Household"); ptag = ptag + " · household"; }
  if (has(["pet","kibble","treat"])) { vset.add("Pet"); ptag = ptag + " · pet"; }
  if (has(["beauty","cosmetic","skincare","lip","cream","lotion","serum"])) { vset.add("Beauty"); ptag = ptag + " · beauty"; }

  const verticals = Array.from(vset);
  return { verticals, ptag };
}

/* ---------------- Buyer pools (US/CA staples + indie Tier C) ---------------- */
type BuyerAB = { host: string; title: string; tier: "A" | "B"; vertical: Vertical; region: Region };
type BuyerC  = { host: string; title: string; vertical: Vertical; region: Region };

const AB: BuyerAB[] = [
  // Beverage
  { host: "coca-colacompany.com", title: "Suppliers | The Coca-Cola Company", tier: "A", vertical: "Beverage", region: "US" },
  { host: "pepsico.com",           title: "Supplier portal | PepsiCo",        tier: "A", vertical: "Beverage", region: "US" },
  { host: "keurigdrpepper.com",    title: "Procurement | Keurig Dr Pepper",   tier: "A", vertical: "Beverage", region: "US" },
  { host: "molsoncoors.com",       title: "Suppliers | Molson Coors",         tier: "B", vertical: "Beverage", region: "US" },

  // Food
  { host: "nestle.com",            title: "Suppliers | Nestlé",               tier: "A", vertical: "Food",     region: "NA" },
  { host: "generalmills.com",      title: "Suppliers | General Mills",        tier: "A", vertical: "Food",     region: "US" },
  { host: "kellanova.com",         title: "Partners | Kellanova",             tier: "A", vertical: "Food",     region: "US" },
  { host: "conagra.com",           title: "Suppliers | Conagra",              tier: "A", vertical: "Food",     region: "US" },
  { host: "campbellsoupcompany.com", title: "Suppliers | Campbell Soup",      tier: "B", vertical: "Food",     region: "US" },
  { host: "kraftheinzcompany.com", title: "Procurement | Kraft Heinz",        tier: "A", vertical: "Food",     region: "US" },
  { host: "hormelfoods.com",       title: "Supplier / vendor info | Hormel",  tier: "A", vertical: "Food",     region: "US" },
  { host: "tysonfoods.com",        title: "Suppliers | Tyson Foods",          tier: "A", vertical: "Food",     region: "US" },
  { host: "smucker.com",           title: "Suppliers | JM Smucker",           tier: "B", vertical: "Food",     region: "US" },
  { host: "chobani.com",           title: "Partners & sourcing | Chobani",    tier: "B", vertical: "Food",     region: "US" },

  // Household
  { host: "pg.com",                title: "Suppliers | P&G",                  tier: "A", vertical: "Household", region: "US" },
  { host: "clorox.com",            title: "Suppliers & procurement | Clorox", tier: "A", vertical: "Household", region: "US" },
  { host: "kimberly-clark.com",    title: "Procurement | Kimberly-Clark",     tier: "A", vertical: "Household", region: "US" },
  { host: "scj.com",               title: "Suppliers | SC Johnson",           tier: "B", vertical: "Household", region: "US" },
  { host: "colgatepalmolive.com",  title: "Partners | Colgate-Palmolive",     tier: "A", vertical: "Household", region: "US" },
  { host: "reckitt.com",           title: "Suppliers | Reckitt",              tier: "B", vertical: "Household", region: "NA" },

  // Beauty
  { host: "unilever.com",          title: "Suppliers | Unilever",             tier: "A", vertical: "Beauty",    region: "NA" },
  { host: "loreal.com",            title: "Suppliers | L’Oréal",              tier: "A", vertical: "Beauty",    region: "NA" },
  { host: "esteeLauder.com",       title: "Suppliers | Estée Lauder",         tier: "B", vertical: "Beauty",    region: "US" },
  { host: "elfcosmetics.com",      title: "Packaging & sourcing | e.l.f.",    tier: "B", vertical: "Beauty",    region: "US" },

  // Retail / Private label
  { host: "walmart.com",           title: "Suppliers | Walmart",              tier: "A", vertical: "Retail",    region: "US" },
  { host: "target.com",            title: "Partners | Target",                tier: "A", vertical: "Retail",    region: "US" },
  { host: "costco.com",            title: "Suppliers | Costco (Kirkland)",    tier: "A", vertical: "Retail",    region: "US" },
  { host: "albertsons.com",        title: "Suppliers | Albertsons",           tier: "B", vertical: "Retail",    region: "US" },
  { host: "kroger.com",            title: "Suppliers | Kroger",               tier: "A", vertical: "Retail",    region: "US" },
  { host: "wholefoodsmarket.com",  title: "Suppliers | Whole Foods",          tier: "B", vertical: "Retail",    region: "US" },
  { host: "traderjoes.com",        title: "Partners | Trader Joe’s",          tier: "B", vertical: "Retail",    region: "US" },
  { host: "sprouts.com",           title: "Own brand packaging | Sprouts",    tier: "B", vertical: "Retail",    region: "US" },
  { host: "wegmans.com",           title: "Private label packaging | Wegmans",tier: "B", vertical: "Retail",    region: "US" },
  { host: "heb.com",               title: "Own brand packaging | H-E-B",      tier: "B", vertical: "Retail",    region: "US" },
  // Canada
  { host: "loblaw.ca",             title: "Suppliers | Loblaw",               tier: "A", vertical: "Retail",    region: "CA" },
  { host: "metro.ca",              title: "Suppliers | Metro",                tier: "B", vertical: "Retail",    region: "CA" },
  { host: "sobeys.com",            title: "Suppliers | Sobeys",               tier: "B", vertical: "Retail",    region: "CA" },

  // Pet
  { host: "purina.com",            title: "Suppliers | Purina",               tier: "A", vertical: "Pet",       region: "US" },
  { host: "bluebuffalo.com",       title: "Partners | Blue Buffalo",          tier: "B", vertical: "Pet",       region: "US" },
];

const C: BuyerC[] = [
  { host: "liquiddeath.com",  title: "Partnerships & operations", vertical: "Beverage", region: "US" },
  { host: "olipop.com",       title: "Vendor / sourcing",         vertical: "Beverage", region: "US" },
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
  { host: "londondrugs.com",  title: "Private label packaging",   vertical: "Retail",   region: "CA" },
];

/* ---------------- Anti-repeat memory per supplier ---------------- */
const recentBySupplier = new Map<string, string[]>(); // supplierHost -> last N buyer hosts
const MAX_RECENT = 6;
function remember(supplier: string, buyerHost: string) {
  const key = normHost(supplier);
  const arr = recentBySupplier.get(key) || [];
  arr.unshift(buyerHost);
  while (arr.length > MAX_RECENT) arr.pop();
  recentBySupplier.set(key, arr);
}
function alreadySeen(supplier: string, buyerHost: string): boolean {
  const arr = recentBySupplier.get(normHost(supplier)) || [];
  return arr.includes(buyerHost);
}

/* ---------------- Scoring/selection ---------------- */
function pickBuyer(
  supplierHost: string,
  region: Region,
  wantTier?: "A" | "B" | "C",
): { host: string; title: string; why: string } {
  const sup = normHost(supplierHost);
  const { verticals, ptag } = inferFromSupplier(supplierHost);

  const abBase = AB.filter(b => b.host !== sup && (b.region === region || b.region === "NA"));
  const cBase  = C .filter(b => b.host !== sup && (b.region === region || b.region === "NA"));

  let ab = abBase.filter(b => (!wantTier || b.tier === wantTier) && verticals.includes(b.vertical));
  let cc = cBase .filter(b => verticals.includes(b.vertical));

  if (!ab.length) ab = abBase.filter(b => !wantTier || b.tier === wantTier);          // relax vertical
  if (!cc.length) cc = cBase;                                                          // relax vertical

  // Score A/B for variety and relevance
  type Scored = BuyerAB & { score: number };
  const scored: Scored[] = ab.map(b => {
    const tierW = b.tier === "A" ? 1.2 : 1.0;
    const vW    = verticals.includes(b.vertical) ? 1.2 : 1.0;
    const seenP = alreadySeen(supplierHost, b.host) ? 0.5 : 1.0; // penalize recent repeats
    const random = 0.8 + Math.random() * 0.4;
    return { ...b, score: tierW * vW * seenP * random };
  }).sort((a,b)=> b.score - a.score);

  let chosenHost = "";
  let chosenTitle = "";
  let chosenWhy = "";

  const tryPick = (list: { host: string; title: string; tier?: any; vertical: Vertical }[], whyMaker: (x:any)=>string) => {
    for (const b of list) {
      if (!alreadySeen(supplierHost, b.host)) {
        chosenHost = b.host;
        chosenTitle = b.title;
        chosenWhy = whyMaker(b);
        return true;
      }
    }
    if (list.length) { // if all seen, take the top anyway
      const b = list[0];
      chosenHost = b.host;
      chosenTitle = b.title;
      chosenWhy = whyMaker(b);
      return true;
    }
    return false;
  };

  if (wantTier === "C") {
    const ccShuffled = cc.sort(()=> Math.random() - 0.5);
    tryPick(ccShuffled, (b)=>`Tier C ${b.vertical}; ${region} indie/retail · ${ptag}`);
  } else if (scored.length) {
    tryPick(scored, (b: Scored)=>`Tier ${b.tier} ${b.vertical}; ${region} supplier program · ${ptag}`);
  } else {
    const ccShuffled = cc.sort(()=> Math.random() - 0.5);
    tryPick(ccShuffled, (b)=>`Tier C ${b.vertical}; ${region} partnerships · ${ptag}`);
  }

  if (!chosenHost) { // ultimate guard
    const any = (abBase[0] || { host: "sprouts.com", title: "Own brand packaging" , vertical:"Retail" as Vertical, tier:"B" as const });
    chosenHost = any.host; chosenTitle = any.title; chosenWhy = `Fallback AB; ${region} · ${ptag}`;
  }

  remember(supplierHost, chosenHost);
  return { host: chosenHost, title: chosenTitle, why: chosenWhy };
}

/* ---------------- GET /leads/find-buyers ---------------- */
router.get("/leads/find-buyers", (req: Request, res: Response) => {
  const supplier = String(req.query.host || "").trim();
  if (!supplier) return res.status(400).json({ error: "host is required" });

  const tierQ = String(req.query.tier || "").toUpperCase();
  const tier: "A" | "B" | "C" | undefined =
    tierQ === "A" || tierQ === "B" || tierQ === "C" ? (tierQ as any) : undefined;

  const region = normalizeRegion(String(req.query.region || ""));

  const result = pickBuyer(supplier, region, tier);

  if (normHost(result.host) === normHost(supplier)) {
    // hard avoid echo
    const alt = pickBuyer("example.com", region, tier);
    return res.json({
      host: alt.host,
      platform: "web",
      title: alt.title || "Buyer lead",
      created: new Date().toISOString(),
      temp: "warm" as const,
      why: alt.why,
      supplier_host: normHost(supplier),
    });
  }

  return res.json({
    host: result.host,
    platform: "web",
    title: result.title || "Buyer lead",
    created: new Date().toISOString(),
    temp: "warm" as const,
    why: result.why,
    supplier_host: normHost(supplier),
  });
});

/* ---------------- POST /leads/lock ---------------- */
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