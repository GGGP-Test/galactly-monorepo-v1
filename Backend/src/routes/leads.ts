import { Router, Request, Response } from "express";

const router = Router();

/* ------------------------------ utils ------------------------------ */

function normHost(raw: string): string {
  try {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) {
      return new URL(s).hostname.replace(/^www\./, "").toLowerCase();
    }
    return s.replace(/^https?:\/\//i, "").replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

type Buyer = {
  host: string;
  title: string;
  why: string;
  region: "US" | "CA" | "NA";
  temp?: "warm" | "hot";
};

const TIER_A: Buyer[] = [
  { host: "hormelfoods.com",           title: "Supplier / vendor info | hormelfoods.com", why: "Tier A CPG; published vendor contact",           region: "US" },
  { host: "generalmills.com",          title: "Supplier portal & sourcing | General Mills", why: "Tier A CPG; strategic sourcing portal",        region: "US" },
  { host: "kraftheinzcompany.com",     title: "Supplier / procurement | Kraft Heinz",       why: "Tier A food; procurement info",                region: "US" },
  { host: "conagrabrands.com",         title: "Supplier resources | Conagra Brands",       why: "Tier A food; supplier resources",               region: "US" },
  { host: "campbellsoupcompany.com",   title: "Supplier onboarding & quality | Campbell",   why: "Tier A food; onboarding guidelines",            region: "US" },
  { host: "pepsico.com",               title: "Procurement / suppliers | PepsiCo",          why: "Tier A beverage; supplier program",            region: "US" },
  { host: "cocacola.com",              title: "Packaging & procurement | Coca-Cola",        why: "Tier A beverage; sourcing info",               region: "US" },
  { host: "mondelezinternational.com", title: "Supplier information | Mondelēz",            why: "Tier A snacks; vendor resources",               region: "US" },
  { host: "clorox.com",                title: "Suppliers & procurement | Clorox",           why: "Tier A CPG; supplier program",                  region: "US" },
  { host: "churchdwight.com",          title: "Procurement info | Church & Dwight",         why: "Tier A household CPG; supplier info",           region: "US" },
  { host: "nestleusa.com",             title: "Suppliers & partners | Nestlé USA",          why: "Tier A food; U.S. supplier portal",             region: "US" },
  { host: "keurigdrpepper.com",        title: "Procurement & suppliers | Keurig Dr Pepper", why: "Tier A beverage; packaging sourcing",          region: "US" },
  { host: "dollargeneral.com",         title: "Supplier / vendor info | Dollar General",    why: "Tier A retail; vendor portal",                  region: "US" },
  { host: "kroger.com",                title: "Vendor & supplier resources | Kroger",       why: "Tier A grocery retail; packaging buyers",       region: "US" },
  { host: "walmart.com",               title: "Supplier center | Walmart",                   why: "Tier A retail; supplier center",                region: "US" },
  { host: "costco.com",                title: "Become a supplier | Costco",                  why: "Tier A retail; vendor onboarding",              region: "US" },
];

const TIER_B: Buyer[] = [
  { host: "albertsons.com",        title: "Suppliers & partners | Albertsons",    why: "Tier B grocery; vendor portal",         region: "US" },
  { host: "meijer.com",            title: "Become a supplier | Meijer",           why: "Tier B retail; onboarding",             region: "US" },
  { host: "bluebell.com",          title: "Vendor / supplier contact | Blue Bell",why: "Tier B dairy; vendor contacts",         region: "US" },
  { host: "tillamook.com",         title: "Supplier & quality requirements",      why: "Tier B dairy; published specs",         region: "US" },
  { host: "snyderslance.com",      title: "Suppliers & sourcing | Snyder’s-Lance",why: "Tier B snacks; packaging demand",       region: "US" },
  { host: "calbeefoods.com",       title: "Supplier info | Calbee North America", why: "Tier B snacks; US/CA operations",       region: "US" },
  { host: "sobeys.com",            title: "Supplier information | Sobeys",        why: "Tier B grocery (CA); vendor program",   region: "CA" },
  { host: "loblaw.ca",             title: "Suppliers | Loblaw Companies",         why: "Tier B grocery (CA); packaging buyers", region: "CA" },
  { host: "canadadrymotts.ca",     title: "Fournisseurs / Suppliers | CDM",       why: "Tier B beverage (CA); vendor info",     region: "CA" },
];

const ALL: Buyer[] = [...TIER_A, ...TIER_B];
const BLOCK = new Set<string>(["peekpackaging.com", "pg.com"]);

function pickBuyer(supplierHost: string, regionHint: string): Buyer {
  const supplier = normHost(supplierHost);
  const region = String(regionHint || "").toUpperCase();

  // Primary filter: remove supplier & blocklist, try region
  let pool = ALL.filter(b => b.host !== supplier && !BLOCK.has(b.host));
  const regionPool = pool.filter(b =>
    !region ? true :
    region.includes("US") && b.region === "US" ||
    region.includes("CA") && b.region === "CA" ||
    region.includes("NA")
  );

  // If region makes it empty, ignore region (never return empty -> avoids UI shim)
  if (regionPool.length > 0) pool = regionPool;

  // Prefer Tier A when available
  const isTierA = (h: string) => TIER_A.some(a => a.host === h);
  const tierA = pool.filter(b => isTierA(b.host));
  const fallback = (arr: Buyer[]) => arr[Math.floor(Math.random() * arr.length)];

  if (tierA.length) return fallback(tierA);
  if (pool.length)  return fallback(pool);

  // Absolute fallback: first Tier A that isn't the supplier
  const abs = TIER_A.find(b => b.host !== supplier) || TIER_B[0];
  return abs;
}

/* ------------------------------ routes ------------------------------ */

// GET /api/leads/find-buyers?host=SUPPLIER&region=US%2FCA&radius=50+mi
router.get("/find-buyers", (_req: Request, res: Response) => {
  const supplierHost = String(_req.query.host || "");
  const regionHint   = String(_req.query.region || "US/CA");

  const chosen = pickBuyer(supplierHost, regionHint);

  // Never empty -> prevents the front-end "compact shim" from fabricating supplier=self
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    host: chosen.host,
    platform: "web",
    title: chosen.title,
    created: new Date().toISOString(),
    temp: chosen.temp || "warm",
    why: chosen.why + ` (picked for supplier: ${normHost(supplierHost)})`,
  });
});

// POST /api/leads/lock { host, title, platform?, temp?, created?, why?, supplier_host? }
router.post("/lock", async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const host  = String(b.host || "").trim();
  const title = String(b.title || "").trim();
  if (!host || !title) return res.status(400).json({ error: "candidate with host and title required" });

  const payload = {
    host,
    title,
    platform: String(b.platform || "web"),
    temp: (String(b.temp || "warm").toLowerCase() as "warm" | "hot"),
    created: String(b.created || new Date().toISOString()),
    why: String(b.why || ""),
    supplier_host: String(b.supplier_host || ""),
  };

  // Optional DB persist (non-blocking)
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.NEON_URL;
  if (url) {
    try {
      const pg: any = await import("pg");
      const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
      await pool.query(`CREATE TABLE IF NOT EXISTS leads(
        id BIGSERIAL PRIMARY KEY,
        host TEXT NOT NULL,
        title TEXT NOT NULL,
        platform TEXT,
        temp TEXT,
        created TIMESTAMPTZ,
        why TEXT,
        supplier_host TEXT
      );`);
      await pool.query(
        `INSERT INTO leads(host,title,platform,temp,created,why,supplier_host) VALUES($1,$2,$3,$4,$5,$6,$7);`,
        [payload.host, payload.title, payload.platform, payload.temp, payload.created, payload.why, payload.supplier_host || null]
      );
      await pool.end().catch(() => {});
    } catch { /* ignore DB errors to keep UX smooth */ }
  }

  return res.status(200).json(payload);
});

export default router;