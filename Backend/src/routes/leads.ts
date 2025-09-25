// src/routes/leads.ts
import { Router, Request, Response } from "express";

/** ---------- Types ---------- */

type Temp = "warm" | "hot" | "cold";

export interface Candidate {
  host: string;             // buyer domain (normalized)
  platform: "web";          // keep simple for now
  title: string;            // short page/section title
  created: string;          // ISO date
  temp: Temp;               // quick sense of fit
  why: string;              // human-readable reason
  score: number;            // internal rank score
}

type Region = "US/CA" | "US" | "CA" | "EU" | "ANY";

interface FindQuery {
  host?: string;
  region?: Region;
  radius?: string;
}

interface LockBody {
  host?: string;
  title?: string;
  temp?: Temp;
}

/** ---------- Small utilities (no network, strongly typed) ---------- */

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

/** Supplier quick heuristics (very light, string-only) */
const supplierHints = (supplierHost: string) => {
  const h = supplierHost;
  const tokens = [
    { key: "shrink", tag: "shrink film" },
    { key: "stretch", tag: "stretch wrap" },
    { key: "label", tag: "labels" },
    { key: "box", tag: "boxes" },
    { key: "carton", tag: "cartons" },
    { key: "bag", tag: "bags" },
    { key: "print", tag: "printing" },
    { key: "pack", tag: "general packaging" },
  ];
  const tags = tokens.filter(t => h.includes(t.key)).map(t => t.tag);
  const vertical: "cpg" | "retail" = "cpg"; // default to CPG; we can expand later
  return { tags, vertical };
};

/** ---------- Curated catalog (zero crawl, safe defaults) ----------
 * We keep a balanced mix of large + mid-market brands.
 * Mid gets a small score boost to suit SMB packaging suppliers.
 */
type CatalogRow = {
  host: string;
  brand: string;
  region: Region;
  size: "large" | "mid";
  category: "cpg" | "retail";
  hasVendorPage: boolean;
};

const CATALOG: CatalogRow[] = [
  // Large CPG (keep but score lower than mid by default)
  { host: "generalmills.com", brand: "General Mills", region: "US/CA", size: "large", category: "cpg", hasVendorPage: true },
  { host: "kraftheinzcompany.com", brand: "Kraft Heinz", region: "US/CA", size: "large", category: "cpg", hasVendorPage: true },
  { host: "scjohnson.com", brand: "SC Johnson", region: "US/CA", size: "large", category: "cpg", hasVendorPage: true },
  { host: "nestle.com", brand: "Nestlé", region: "US/CA", size: "large", category: "cpg", hasVendorPage: true },
  { host: "unilever.com", brand: "Unilever", region: "US/CA", size: "large", category: "cpg", hasVendorPage: true },

  // Retail (CA focus examples kept)
  { host: "loblaw.ca", brand: "Loblaw", region: "CA", size: "large", category: "retail", hasVendorPage: true },
  { host: "metro.ca", brand: "Metro", region: "CA", size: "large", category: "retail", hasVendorPage: true },

  // Mid-market / better fit for many packaging SMBs
  { host: "califiafarms.com", brand: "Califia Farms", region: "US/CA", size: "mid", category: "cpg", hasVendorPage: true },
  { host: "kindsnacks.com", brand: "KIND Snacks", region: "US/CA", size: "mid", category: "cpg", hasVendorPage: true },
  { host: "perfectsnacks.com", brand: "Perfect Snacks", region: "US/CA", size: "mid", category: "cpg", hasVendorPage: true },
  { host: "clifbar.com", brand: "Clif Bar", region: "US/CA", size: "mid", category: "cpg", hasVendorPage: true },
  { host: "sietefoods.com", brand: "Siete Foods", region: "US/CA", size: "mid", category: "cpg", hasVendorPage: true },
  { host: "health-ade.com", brand: "Health-Ade", region: "US/CA", size: "mid", category: "cpg", hasVendorPage: true },
  { host: "liquiddeath.com", brand: "Liquid Death", region: "US/CA", size: "mid", category: "cpg", hasVendorPage: true },
  { host: "olliebeverage.com", brand: "Ollie Beverage", region: "US/CA", size: "mid", category: "cpg", hasVendorPage: true },
];

/** rank score (purely local math, no network) */
const scoreRow = (row: CatalogRow, supplier: string, region: Region, vertical: "cpg" | "retail"): number => {
  let s = 50;

  // Encourage region compatibility (US/CA is broad)
  if (row.region === "US/CA" || region === "US/CA" || row.region === region) s += 10;

  // Prefer requested vertical
  if (row.category === vertical) s += 8;

  // Prefer mid-market for SMB packaging suppliers
  s += row.size === "mid" ? 12 : 0;

  // Small bonus when vendor/supplier program is known
  if (row.hasVendorPage) s += 5;

  // Avoid returning the supplier itself or its subdomain cousins
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

/** ---------- Router ---------- */

export const leadsRouter = Router();

/** Health */
leadsRouter.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, ts: nowIso() });
});

/** Lock (warm/hot) — minimal durable guard, no type pitfalls */
leadsRouter.post("/lock", (req: Request<unknown, unknown, LockBody>, res: Response) => {
  const { host, title, temp } = req.body || {};
  if (!host || !title) {
    res.status(400).json({ error: "candidate with host and title required" });
    return;
  }
  // Here we could persist to Neon later; for now acknowledge.
  res.json({ ok: true, host: normalizeHost(host), title, temp: temp ?? "warm" });
});

/** Find buyers */
leadsRouter.get("/find-buyers", (req: Request<unknown, unknown, unknown, FindQuery>, res: Response) => {
  const supplierHostRaw = (req.query.host || "").toString();
  const region = (req.query.region as Region) || "US/CA";
  // radius is accepted but not used at catalog level yet
  const supplierHost = normalizeHost(supplierHostRaw);

  if (!supplierHost) {
    res.status(400).json({ error: "host required" });
    return;
  }

  // Hints from supplier to steer category + copy
  const hints = supplierHints(supplierHost);
  const whyTag = hints.tags.length ? `fit: ${hints.tags.join(", ")}` : "fit: general packaging";

  // Build scored candidate list
  const candidates: Candidate[] = [];
  for (const row of CATALOG) {
    // Region gating: loose if either side is US/CA, strict otherwise
    const regionOk =
      row.region === "US/CA" ||
      region === "US/CA" ||
      row.region === region;

    if (!regionOk) continue;

    const score = scoreRow(row, supplierHost, region, hints.vertical);
    if (score <= 0) continue; // filtered out (same domain family, etc.)

    // Temp heuristic: >70 hot, else warm
    const temp: Temp = score >= 70 ? "hot" : "warm";

    const why = joinWhy(
      whyTag,
      row.category === "cpg" ? "category: CPG" : "category: retail",
      row.size === "mid" ? "size: mid-market" : "size: large",
      row.hasVendorPage ? "vendor page known" : undefined,
      `picked for supplier: ${supplierHost}`
    );

    candidates.push(toCandidate(row, why, temp, score));
  }

  // Dedupe strictly by host string (avoid the earlier Candidate vs string bug)
  const seen = new Set<string>();
  const deduped: Candidate[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (seen.has(c.host)) continue;
    seen.add(c.host);
    deduped.push(c);
  }

  // Trim to a sensible page size for the free panel
  const items = deduped.slice(0, 10);

  res.json({ items });
});

/** Default export for app wiring */
export default leadsRouter;