// scripts/find-buyers-batch.ts
//
// Batch "find buyers" importer for your Artemis B API.
// - Primary: GET /api/leads/find-buyers?host=...&limit=...&minTier=...
// - Fallback:  /api/leads/find (legacy)
// - Auth: accepts either x-admin-key or x-admin-token (pick via --adminHeader)
// - CSV: looks for domain | website | company columns
//
// CLI (from Backend/):
//   npx tsx ./scripts/find-buyers-batch.ts \
//     --api https://<host>/api \
//     --csv data/companies.csv \
//     --dryRun false \
//     --maxCompanies 0 \
//     --maxBuyersPerCompany 30 \
//     --adminKey $ADMIN_TOKEN \
//     --adminHeader x-admin-key \
//     --minTier C
//
// Also reads env: API_BASE, ADMIN_TOKEN, ADMIN_HEADER, MIN_TIER

/* eslint-disable no-console */
import fs from "fs/promises";
import path from "path";

// ---------------- CLI ----------------

type Tier = "A" | "B" | "C";
interface Args {
  api: string;
  csv: string;
  dryRun: boolean;
  maxCompanies: number;
  maxBuyersPerCompany: number;
  adminKey?: string;
  adminHeader?: string; // x-admin-key | x-admin-token
  minTier?: Tier;       // A|B|C
}

function parseArgs(): Args {
  const a = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const key = (process.argv[i] || "").replace(/^--/, "");
    if (!key) continue;
    const nxt = process.argv[i + 1];
    if (!nxt || nxt.startsWith("--")) { a.set(key, "true"); continue; }
    a.set(key, nxt); i++;
  }
  const bool = (v?: string) => String(v).toLowerCase() === "true";
  const num  = (v?: string, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
  const asTier = (v?: string): Tier|undefined => {
    const t = String(v || "").trim().toUpperCase();
    return t === "A" || t === "B" || t === "C" ? (t as Tier) : undefined;
  };

  const args: Args = {
    api: (a.get("api") || process.env.API_BASE || "").replace(/\/+$/, ""),
    csv: a.get("csv") || "data/companies.csv",
    dryRun: bool(a.get("dryRun")),
    maxCompanies: num(a.get("maxCompanies"), 0),
    maxBuyersPerCompany: num(a.get("maxBuyersPerCompany"), 30),
    adminKey: a.get("adminKey") || process.env.ADMIN_TOKEN || process.env.ADMIN_KEY_VALUE,
    adminHeader: a.get("adminHeader") || process.env.ADMIN_HEADER || "x-admin-key",
    minTier: asTier(a.get("minTier") || process.env.MIN_TIER),
  };
  if (!args.api) throw new Error("API base required: --api https://host/api");
  return args;
}

// --------------- CSV + utils ----------------

function toDomain(s?: string): string | undefined {
  if (!s) return;
  let t = s.trim();
  if (!t) return;
  if (!/^https?:\/\//i.test(t)) t = "http://" + t;
  try { return new URL(t).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return t.replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0].toLowerCase(); }
}

type CompanyRow = { company?: string; domain?: string; website?: string; city?: string; region?: string; country?: string };

function parseCSV(txt: string): CompanyRow[] {
  const lines = txt.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  const idx = (n: string) => header.findIndex(h => h === n);
  const iCompany = idx("company") >= 0 ? idx("company") : idx("company name");
  const iDomain  = idx("domain");
  const iWebsite = idx("website");
  const iCity    = idx("city");
  const iRegion  = idx("region") >= 0 ? idx("region") : idx("state");
  const iCountry = idx("country");

  const rows: CompanyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    rows.push({
      company: iCompany >= 0 ? cols[iCompany]?.trim() : undefined,
      domain:  iDomain  >= 0 ? cols[iDomain]?.trim()  : undefined,
      website: iWebsite >= 0 ? cols[iWebsite]?.trim() : undefined,
      city:    iCity    >= 0 ? cols[iCity]?.trim()    : undefined,
      region:  iRegion  >= 0 ? cols[iRegion]?.trim()  : undefined,
      country: iCountry >= 0 ? cols[iCountry]?.trim() : undefined,
    });
  }
  return rows;
}

function joinApi(base: string, p: string) {
  return base.replace(/\/+$/, "") + "/" + p.replace(/^\/+/, "");
}

// --------------- HTTP ----------------

async function fetchText(url: string, opts: any): Promise<{ ok: boolean; status: number; text: string }> {
  const r = await fetch(url, opts);
  const t = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, text: t };
}

async function callFind(
  api: string,
  domain: string,
  limit: number,
  minTier?: Tier,
  adminHeader?: string,
  adminKey?: string,
  dryRun?: boolean
): Promise<{ ok: boolean; status: number; text: string }> {
  const headers: Record<string, string> = {};
  if (adminKey && adminHeader) headers[adminHeader] = adminKey;

  // Prefer the new route: /api/leads/find-buyers
  const url = new URL(joinApi(api, "/leads/find-buyers"));
  url.searchParams.set("host", domain);
  if (limit > 0) url.searchParams.set("limit", String(limit));
  if (minTier) url.searchParams.set("minTier", minTier);
  if (dryRun) url.searchParams.set("dryRun", "1");

  let res = await fetchText(url.toString(), { method: "GET", headers });

  // Fallback to the legacy /api/leads/find (GET then POST)
  if (res.status === 404 || /Cannot\s+GET/i.test(res.text)) {
    const legacyGet = new URL(joinApi(api, "/leads/find"));
    legacyGet.searchParams.set("host", domain);
    if (limit > 0) legacyGet.searchParams.set("limit", String(limit));
    if (minTier) legacyGet.searchParams.set("minTier", minTier);
    if (dryRun) legacyGet.searchParams.set("dryRun", "1");
    res = await fetchText(legacyGet.toString(), { method: "GET", headers });

    if (res.status === 404 || /Cannot\s+GET/i.test(res.text)) {
      const body = { host: domain, limit: limit > 0 ? limit : undefined, minTier, dryRun: !!dryRun };
      headers["Content-Type"] = "application/json";
      res = await fetchText(joinApi(api, "/leads/find"), { method: "POST", headers, body: JSON.stringify(body) });
    }
  }
  return res;
}

async function pushSummaryEvent(api: string, adminHeader: string|undefined, adminKey: string|undefined, summary: any) {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (adminHeader && adminKey) headers[adminHeader] = adminKey;
    await fetch(joinApi(api, "/events/ingest"), {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "import", user: "actions", path: "/scripts/find-buyers-batch", meta: summary }),
    });
  } catch { /* non-fatal */ }
}

// --------------- Main ----------------

async function main() {
  const args = parseArgs();
  console.log("Importer starting…");
  console.log("API_BASE=%s", args.api.replace(/^https?:\/\//, "").replace(/\/.*/, ""));
  console.log("dryRun=%s", args.dryRun);
  if (args.maxCompanies) console.log("maxCompanies=%d", args.maxCompanies);
  if (args.minTier) console.log("minTier=%s", args.minTier);

  const csvPath = path.resolve(process.cwd(), args.csv);
  const exists = await fs.stat(csvPath).then(() => true).catch(() => false);
  if (!exists) throw new Error(`CSV not found: ${csvPath}`);

  const txt = await fs.readFile(csvPath, "utf8");
  const rows = parseCSV(txt);

  const uniq = Array.from(new Set(
    rows.map(r => toDomain(r.domain) || toDomain(r.website)).filter(Boolean) as string[]
  ));

  const take = args.maxCompanies > 0 ? uniq.slice(0, args.maxCompanies) : uniq;
  console.log(`Unique companies (by domain): ${uniq.length}. Processing: ${take.length}`);

  let ok = 0, fail = 0, i = 0;
  for (const d of take) {
    i++;
    const res = await callFind(args.api, d, args.maxBuyersPerCompany, args.minTier, args.adminHeader, args.adminKey, args.dryRun);
    if (res.ok) { console.log(`✓ ${i}/${take.length} ${d} -> ${res.status}`); ok++; }
    else {
      const firstLine = (res.text || "").split("\n")[0];
      console.log(`✗ ${i}/${take.length} ${d} -> ${res.status} ${firstLine}`);
      fail++;
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  await pushSummaryEvent(args.api, args.adminHeader, args.adminKey, { ok, fail, minTier: args.minTier || null, dryRun: args.dryRun });

  if (!args.dryRun && fail > 0) process.exit(2);
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });