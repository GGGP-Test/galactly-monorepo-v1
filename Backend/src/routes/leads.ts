import { Router, Request, Response } from "express";

/** ---------- Types ---------- */

type Temp = "warm" | "hot" | "cold";

export interface Candidate {
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: Temp;
  why: string;
  score: number;
}

type Region = "US/CA" | "US" | "CA" | "EU" | "ANY";

interface FindQuery {
  host?: string;
  region?: string;          // may arrive URL-encoded; we normalize
  radius?: string;          // accepted, currently not used for catalog
}

interface LockBody {
  host?: string;
  title?: string;
  temp?: Temp;
}

/** ---------- utils ---------- */

const nowIso = () => new Date().toISOString();

const normalizeHost = (h: string): string =>
  h.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

const isSubdomainOf = (child: string, parent: string): boolean =>
  child === parent || child.endsWith("." + parent);

const joinWhy = (...parts: Array<string | undefined | null>) =>
  parts.filter(Boolean).join(" · ");

const clamp = (x: number, min = 0, max = 100) => Math.max(min, Math.min(max, x));

const asRegion = (raw: unknown): Region => {
  const decoded = decodeURIComponent(String(raw ?? "US/CA")).toUpperCase();
  if (decoded === "US/CA" || decoded === "US" || decoded === "CA" || decoded === "EU" || decoded === "ANY") {
    return decoded as Region;
  }
  return "US/CA";
};

const supplierHints = (supplierHost: string) => {
  const h = supplierHost;
  const tokens = [
    { key: "shrink", tag: "shrink film" },
    { key: "stretch", tag: "stretch wrap" },
    { key: "label",  tag: "labels" },
    { key: "box",    tag: "boxes" },
    { key: "carton", tag: "cartons" },
    { key: "bag",    tag: "bags" },
    { key: "print",  tag: "printing" },
    { key: "pack",   tag: "general packaging" },
  ];
  const tags = tokens.filter(t => h.includes(t.key)).map(t => t.tag);
  const vertical: "cpg" | "retail" = "cpg"; // default vertical
  return { tags, vertical };
};

/** ---------- tiny curated catalog (expandable) ---------- */

type CatalogRow = {
  host: string;
  brand: string;
  region: Region;
  size: "large" | "mid";
  category: "cpg" | "retail";
  hasVendorPage: boolean;
};

// NOTE: favor mid-market buyers; still keep some large logos
const CATALOG: CatalogRow[] = [
  // mid-market CPG
  { host: "califiafarms.com",   brand: "Califia Farms",   region: "US/CA", size: "mid",   category: "cpg",    hasVendorPage: true },
  { host: "kindsnacks.com",     brand: "KIND Snacks",     region: "US/CA", size: "mid",   category: "cpg",    hasVendorPage: true },
  { host: "perfectsnacks.com",  brand: "Perfect Snacks",  region: "US/CA", size: "mid",   category: "cpg",    hasVendorPage: true },
  { host: "clifbar.com",        brand: "Clif Bar",        region: "US/CA", size: "mid",   category: "cpg",    hasVendorPage: true },
  { host: "sietefoods.com",     brand: "Siete Foods",     region: "US/CA", size: "mid",   category: "cpg",    hasVendorPage: true },
  { host: "health-ade.com",     brand: "Health-Ade",      region: "US/CA", size: "mid",   category: "cpg",    hasVendorPage: true },
  { host: "liquiddeath.com",    brand: "Liquid Death",    region: "US/CA", size: "mid",   category: "cpg",    hasVendorPage: true },

  // retail (CA + US examples)
  { host: "sprouts.com",        brand: "Sprouts",         region: "US",    size: "mid",   category: "retail", hasVendorPage: true },
  { host: "wegmans.com",        brand: "Wegmans",         region: "US",    size: "mid",   category: "retail", hasVendorPage: true },
  { host: "loblaw.ca",          brand: "Loblaw",          region: "CA",    size: "large", category: "retail", hasVendorPage: true },
  { host: "metro.ca",           brand: "Metro",           region: "CA",    size: "large", category: "retail", hasVendorPage: true },

  // keep a few large CPG logos (less score by default)
  { host: "kraftheinzcompany.com", brand: "Kraft Heinz",  region: "US/CA", size: "large", category: "cpg",    hasVendorPage: true },
  { host: "generalmills.com",      brand: "General Mills",region: "US/CA", size: "large", category: "cpg",    hasVendorPage: true },
  { host: "scjohnson.com",         brand: "SC Johnson",   region: "US/CA", size: "large", category: "cpg",    hasVendorPage: true },
];

const scoreRow = (row: CatalogRow, supplier: string, region: Region, vertical: "cpg" | "retail"): number => {
  let s = 50;

  // region compatibility (loose if either side is US/CA)
  if (row.region === "US/CA" || region === "US/CA" || row.region === region) s += 10;

  // prefer requested vertical
  if (row.category === vertical) s += 8;

  // prefer mid-market for packaging SMBs
  if (row.size === "mid") s += 12;

  if (row.hasVendorPage) s += 5;

  // never return the supplier itself or cousins
  const supplierHost = normalizeHost(supplier);
  if (isSubdomainOf(row.host, supplierHost) || isSubdomainOf(supplierHost, row.host)) s = 0;

  return clamp(s, 0, 100);
};

const toCandidate = (row: CatalogRow, why: string, temp: Temp, score: number): Candidate => ({
  host: row.host,
  platform: "web",
  title: `Suppliers / vendor info | ${row.brand}`,
  created: nowIso(),
  temp,
  why,
  score,
});

/** ---------- router ---------- */

export const leadsRouter = Router();

leadsRouter.get("/healthz", (_req, res) => {
  res.json({ ok: true, ts: nowIso(), catalog: CATALOG.length });
});

leadsRouter.post("/lock", (req: Request<unknown, unknown, LockBody>, res: Response) => {
  const { host, title, temp } = req.body || {};
  if (!host || !title) {
    res.status(400).json({ error: "candidate with host and title required" });
    return;
  }
  res.json({ ok: true, host: normalizeHost(host), title, temp: temp ?? "warm" });
});

leadsRouter.get("/find-buyers", (req: Request<unknown, unknown, unknown, FindQuery>, res: Response) => {
  const supplierHost = normalizeHost(String(req.query.host ?? ""));
  const region = asRegion(req.query.region);
  // radius accepted but not used here
  if (!supplierHost) {
    res.status(400).json({ error: "host required" });
    return;
  }

  const hints = supplierHints(supplierHost);
  const whyTag = hints.tags.length ? `fit: ${hints.tags.join(", ")}` : "fit: general packaging";

  // score & collect
  const scored: Candidate[] = [];
  for (const row of CATALOG) {
    const score = scoreRow(row, supplierHost, region, hints.vertical);
    if (score <= 0) continue;

    const temp: Temp = score >= 70 ? "hot" : "warm";
    const why = joinWhy(
      whyTag,
      row.category === "cpg" ? "category: CPG" : "category: retail",
      row.size === "mid" ? "size: mid-market" : "size: large",
      row.hasVendorPage ? "vendor page known" : undefined,
      `picked for supplier: ${supplierHost}`
    );

    scored.push(toCandidate(row, why, temp, score));
  }

  // dedupe by host, sort by score
  const seen = new Set<string>();
  const sorted = scored.sort((a, b) => b.score - a.score);
  const items: Candidate[] = [];
  for (const c of sorted) {
    if (seen.has(c.host)) continue;
    seen.add(c.host);
    items.push(c);
  }

  // GUARANTEED FALLBACK: if empty, loosen filters completely
  if (items.length === 0) {
    const fallback: Candidate[] = [];
    for (const row of CATALOG) {
      // avoid the supplier itself
      if (isSubdomainOf(normalizeHost(row.host), supplierHost) || isSubdomainOf(supplierHost, normalizeHost(row.host))) continue;
      const why = joinWhy(
        "baseline: catalog fallback",
        row.category === "cpg" ? "category: CPG" : "category: retail",
        row.size === "mid" ? "size: mid-market" : "size: large",
        row.hasVendorPage ? "vendor page known" : undefined,
        `picked for supplier: ${supplierHost}`
      );
      const s = 60 + (row.size === "mid" ? 8 : 0);
      const t: Temp = s >= 70 ? "hot" : "warm";
      fallback.push(toCandidate(row, why, t, s));
    }
    // still dedupe + cap result size
    const seen2 = new Set<string>();
    const capped: Candidate[] = [];
    for (const c of fallback) {
      if (seen2.has(c.host)) continue;
      seen2.add(c.host);
      capped.push(c);
      if (capped.length >= 8) break;
    }
    res.json({ items: capped });
    return;
  }

  res.json({ items: items.slice(0, 10) });
});

export default leadsRouter;