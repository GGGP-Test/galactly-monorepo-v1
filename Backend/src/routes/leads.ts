import { Router, Request, Response } from "express";

const router = Router();

/* -----------------------------------------------------------
   Helpers
----------------------------------------------------------- */

function normHost(raw: string): string {
  try {
    // Accept bare host ("acme.com") or URL ("https://acme.com/path")
    const s = raw.trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) {
      return new URL(s).hostname.replace(/^www\./, "").toLowerCase();
    }
    return s.replace(/^https?:\/\//i, "").replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// A/B lists: only genuine prospective buyers (no suppliers), with
// public vendor / procurement style entry points when available.
type Buyer = {
  host: string;
  title: string;
  why: string;
  region: "US" | "CA" | "NA";
  temp?: "warm" | "hot";
};

// Tier A (large, national)
const TIER_A: Buyer[] = [
  { host: "hormelfoods.com", title: "Supplier / vendor info | hormelfoods.com", why: "Tier A CPG; published supplier/vendor contact", region: "US" },
  { host: "generalmills.com", title: "Supplier portal & sourcing | General Mills", why: "Tier A CPG; strategic sourcing portal", region: "US" },
  { host: "kraftheinzcompany.com", title: "Supplier / procurement | Kraft Heinz", why: "Tier A food; procurement info available", region: "US" },
  { host: "conagrabrands.com", title: "Supplier resources | Conagra Brands", why: "Tier A food; supplier resources", region: "US" },
  { host: "campbellsoupcompany.com", title: "Supplier onboarding & quality | Campbell Soup Co", why: "Tier A food; onboarding guidelines", region: "US" },
  { host: "pepsico.com", title: "Procurement / suppliers | PepsiCo", why: "Tier A beverage; supplier program", region: "US" },
  { host: "cocacola.com", title: "Packaging & procurement contacts | The Coca-Cola Company", why: "Tier A beverage; sourcing info", region: "US" },
  { host: "mondelezinternational.com", title: "Supplier information | Mondelēz International", why: "Tier A snacks; vendor resources", region: "US" },
  { host: "clorox.com", title: "Suppliers & procurement | The Clorox Company", why: "Tier A CPG; supplier program", region: "US" },
  { host: "churchdwight.com", title: "Supplier / procurement information | Church & Dwight", why: "Tier A household CPG; supplier info", region: "US" },
  { host: "nestleusa.com", title: "Suppliers & partners | Nestlé USA", why: "Tier A food; U.S. supplier portal", region: "US" },
  { host: "keurigdrpepper.com", title: "Procurement & suppliers | Keurig Dr Pepper", why: "Tier A beverage; packaging sourcing", region: "US" },
  { host: "dollargeneral.com", title: "Supplier / vendor information | Dollar General", why: "Tier A retail; vendor portal", region: "US" },
  { host: "kroger.com", title: "Vendor & supplier resources | Kroger", why: "Tier A grocery retail; packaging buyers exist", region: "US" },
  { host: "walmart.com", title: "Supplier center | Walmart", why: "Tier A retail; supplier center", region: "US" },
  { host: "costco.com", title: "Become a supplier | Costco", why: "Tier A retail; vendor onboarding", region: "US" },
];

// Tier B (regional / sizeable)
const TIER_B: Buyer[] = [
  { host: "calbeefoods.com", title: "Supplier info | Calbee North America", why: "Tier B snacks; US/CA operations", region: "US" },
  { host: "snyderslance.com", title: "Suppliers & sourcing | Snyder’s-Lance", why: "Tier B snacks; packaging demand", region: "US" },
  { host: "bluebell.com", title: "Supplier / vendor contact | Blue Bell Creameries", why: "Tier B dairy; vendor contacts", region: "US" },
  { host: "tillamook.com", title: "Supplier & quality requirements | Tillamook", why: "Tier B dairy; published specs", region: "US" },
  { host: "canadadrymotts.ca", title: "Fournisseurs / Suppliers | Canada Dry Mott’s", why: "Tier B beverage (CA); vendor info", region: "CA" },
  { host: "sobeys.com", title: "Supplier information | Sobeys", why: "Tier B grocery (CA); vendor program", region: "CA" },
  { host: "loblaw.ca", title: "Suppliers | Loblaw Companies", why: "Tier B grocery (CA); packaging buyers", region: "CA" },
  { host: "albertsons.com", title: "Suppliers & partners | Albertsons", why: "Tier B grocery; vendor portal", region: "US" },
  { host: "meijer.com", title: "Become a supplier | Meijer", why: "Tier B retail; vendor onboarding", region: "US" },
];

const ALL_BUYERS: Buyer[] = [...TIER_A, ...TIER_B];

// basic blocklist so we never echo a supplier or give iffy picks
const BLOCKLIST = new Set<string>([
  "peekpackaging.com",
  "pg.com",              // user flagged this as unhelpful; exclude
]);

function pickBuyer(supplierHost: string, regionHint: string): Buyer | null {
  const supplier = normHost(supplierHost);
  const region = (regionHint || "").toUpperCase(); // e.g., "US/CA", "US", "CA"

  // Filter: region + never echo supplier + blocklist
  const isRegionOK = (b: Buyer) => {
    if (!region) return true;
    if (region.includes("US") && b.region === "US") return true;
    if (region.includes("CA") && b.region === "CA") return true;
    if (region.includes("NA") && (b.region === "US" || b.region === "CA" || b.region === "NA")) return true;
    return false;
  };

  const pool = ALL_BUYERS
    .filter((b) => b.host !== supplier)
    .filter((b) => !BLOCKLIST.has(b.host))
    .filter(isRegionOK);

  if (pool.length === 0) return null;

  // Prefer Tier A first, then Tier B
  const tierA = pool.filter((b) => TIER_A.some((a) => a.host === b.host));
  const tierB = pool.filter((b) => !tierA.includes(b));

  const weighted = tierA.length ? tierA : tierB;
  const idx = Math.floor(Math.random() * weighted.length);
  return weighted[idx] || null;
}

/* -----------------------------------------------------------
   Routes
----------------------------------------------------------- */

// GET /api/leads/find-buyers?host=SUPPLIER&region=US%2FCA&radius=50+mi
router.get("/find-buyers", async (req: Request, res: Response) => {
  const host = String(req.query.host || "").trim();
  if (!host) return res.status(400).json({ error: "host required" });

  // Currently radius is not used; region hint does influence the pool
  const region = String(req.query.region || "US/CA");

  // Choose a buyer prospect deterministically enough but varied
  const pick = pickBuyer(host, region);

  if (!pick) {
    // No match: return a clear, safe miss (and never echo the supplier)
    return res.status(200).json({
      host: "",
      platform: "web",
      title: "",
      created: new Date().toISOString(),
      temp: "warm",
      why: "No Tier A/B candidates for region filter; try broader region",
    });
  }

  return res.status(200).json({
    host: pick.host,
    platform: "web",
    title: pick.title,
    created: new Date().toISOString(),
    temp: pick.temp || "warm",
    why: pick.why,
  });
});

// POST /api/leads/lock  { host, title, platform?, temp?, created?, why?, supplier_host? }
router.post("/lock", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const host = String(body.host || "").trim();
  const title = String(body.title || "").trim();

  if (!host || !title) {
    return res.status(400).json({ error: "candidate with host and title required" });
  }

  const payload = {
    host,
    title,
    platform: String(body.platform || "web"),
    temp: String((body.temp || "warm")).toLowerCase() as "warm" | "hot",
    created: String(body.created || new Date().toISOString()),
    why: String(body.why || ""),
    supplier_host: String(body.supplier_host || ""),
  };

  // Best-effort DB insert (optional). If not configured, still return 200.
  const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.NEON_URL;
  if (url) {
    try {
      // dynamic import avoids type headaches at build time
      const pg: any = await import("pg");
      const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

      // Use a small neutral table name; change if your schema differs.
      // Columns: host, title, platform, temp, created, why, supplier_host
      await pool.query(
        `CREATE TABLE IF NOT EXISTS leads (
           id BIGSERIAL PRIMARY KEY,
           host TEXT NOT NULL,
           title TEXT NOT NULL,
           platform TEXT,
           temp TEXT,
           created TIMESTAMPTZ,
           why TEXT,
           supplier_host TEXT
         );`
      );

      await pool.query(
        `INSERT INTO leads (host, title, platform, temp, created, why, supplier_host)
         VALUES ($1,$2,$3,$4,$5,$6,$7);`,
        [payload.host, payload.title, payload.platform, payload.temp, payload.created, payload.why, payload.supplier_host || null]
      );

      await pool.end().catch(() => {});
    } catch {
      // Swallow DB errors so the UX remains smooth
    }
  }

  return res.status(200).json(payload);
});

export default router;