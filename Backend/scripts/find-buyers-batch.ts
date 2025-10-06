// scripts/find-buyers-batch.ts
//
// Batch "find buyers" importer that reads a companies CSV and calls your API.
// - Prefers GET /api/leads/find (Admin Dashboard style); falls back to POST if needed
// - Accepts either x-admin-key or x-admin-token (you choose via --adminHeader)
// - Minimal CSV parser: looks for domain | website | company columns
//
// Usage (from Backend/):
//   npx tsx ./scripts/find-buyers-batch.ts \
//     --api https://<host>/api \
//     --csv data/companies.csv \
//     --dryRun false \
//     --maxCompanies 0 \
//     --maxBuyersPerCompany 30 \
//     --adminKey $ADMIN_TOKEN \
//     --adminHeader x-admin-token

import fs from "fs/promises";
import path from "path";

// ---------------- CLI ----------------

interface Args {
  api: string;                   // e.g., https://host/api   (no trailing slash ok)
  csv: string;                   // e.g., data/companies.csv
  dryRun: boolean;
  maxCompanies: number;          // 0 = all
  maxBuyersPerCompany: number;   // cap per company
  adminKey?: string;             // optional
  adminHeader?: string;          // x-admin-key | x-admin-token (default x-admin-key)
}

function parseArgs(): Args {
  const a = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = (process.argv[i] || "").replace(/^--/, "");
    const v = process.argv[i + 1];
    if (!k) continue;
    if (v == null || v.startsWith("--")) {
      // flags that might be standalone booleans, step back one
      i -= 1;
      continue;
    }
    a.set(k, v);
  }
  const bool = (v?: string) => (String(v).toLowerCase() === "true");
  const num = (v?: string, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };

  const args: Args = {
    api: (a.get("api") || process.env.API_BASE || "").replace(/\/+$/, ""),
    csv: a.get("csv") || "data/companies.csv",
    dryRun: bool(a.get("dryRun")),
    maxCompanies: num(a.get("maxCompanies"), 0),
    maxBuyersPerCompany: num(a.get("maxBuyersPerCompany"), 30),
    adminKey: a.get("adminKey") || process.env.ADMIN_TOKEN || process.env.ADMIN_KEY_VALUE,
    adminHeader: a.get("adminHeader") || process.env.ADMIN_HEADER || "x-admin-key",
  };

  if (!args.api) throw new Error("API base required: --api https://host/api");
  return args;
}

// --------------- CSV + utils ----------------

function toDomain(s?: string): string | undefined {
  if (!s) return undefined;
  let t = s.trim();
  if (!t) return undefined;
  // tolerate raw domains or URLs
  try { if (!/^https?:\/\//i.test(t)) t = "http://" + t; } catch {}
  try {
    const h = new URL(t).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch {
    return t.replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

type CompanyRow = { company?: string; domain?: string; website?: string; city?: string; region?: string; country?: string };

function parseCSV(txt: string): CompanyRow[] {
  // very light parser (no complex quoting); good enough for simple lists
  const lines = txt.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  const idx = (name: string) => header.findIndex(h => h === name);
  const iCompany = idx("company") >= 0 ? idx("company") : idx("company name");
  const iDomain  = idx("domain");
  const iWebsite = idx("website");
  const iCity    = idx("city");
  const iRegion  = idx("region") >= 0 ? idx("region") : idx("state");
  const iCountry = idx("country");

  const rows: CompanyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(","); // simple split
    const row: CompanyRow = {
      company: iCompany >= 0 ? cols[iCompany]?.trim() : undefined,
      domain:  iDomain  >= 0 ? cols[iDomain]?.trim()  : undefined,
      website: iWebsite >= 0 ? cols[iWebsite]?.trim() : undefined,
      city:    iCity    >= 0 ? cols[iCity]?.trim()    : undefined,
      region:  iRegion  >= 0 ? cols[iRegion]?.trim()  : undefined,
      country: iCountry >= 0 ? cols[iCountry]?.trim() : undefined,
    };
    rows.push(row);
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
  adminHeader?: string,
  adminKey?: string,
  dryRun?: boolean
): Promise<{ ok: boolean; status: number; text: string }> {
  const headers: Record<string, string> = {};
  if (adminKey && adminHeader) headers[adminHeader] = adminKey;

  // Prefer GET first
  const getUrl = new URL(joinApi(api, "/leads/find"));
  // support either ?domain= or ?host= on the server
  getUrl.searchParams.set("domain", domain);
  getUrl.searchParams.set("host", domain);
  if (limit > 0) getUrl.searchParams.set("max", String(limit));
  if (dryRun) getUrl.searchParams.set("dryRun", "1");

  let res = await fetchText(getUrl.toString(), { method: "GET", headers });

  // If the server doesn’t support GET, fall back to POST
  if (res.status === 404 || /Cannot\s+GET/i.test(res.text)) {
    const postUrl = joinApi(api, "/leads/find");
    const body = { host: domain, domain, max: limit > 0 ? limit : undefined, dryRun: !!dryRun };
    headers["Content-Type"] = "application/json";
    res = await fetchText(postUrl, { method: "POST", headers, body: JSON.stringify(body) });
  }

  return res;
}

// --------------- Main ----------------

async function main() {
  const args = parseArgs();
  console.log("Importer starting…");
  console.log("API_BASE=%s", args.api.replace(/^https?:\/\//, "").replace(/\/.*/, ""));
  console.log("dryRun=%s", args.dryRun);
  if (args.maxCompanies) console.log("limit=%d", args.maxCompanies);

  const csvPath = path.resolve(process.cwd(), args.csv);
  const exists = await fs
    .stat(csvPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) throw new Error(`CSV not found: ${csvPath}`);

  const txt = await fs.readFile(csvPath, "utf8");
  const rows = parseCSV(txt);

  // Build unique domains
  const uniq = Array.from(
    new Set(
      rows
        .map(r => toDomain(r.domain) || toDomain(r.website))
        .filter(Boolean) as string[]
    )
  );

  const take = args.maxCompanies && args.maxCompanies > 0 ? uniq.slice(0, args.maxCompanies) : uniq;
  console.log(`Unique companies (by domain): ${uniq.length}. Processing: ${take.length}`);

  let ok = 0, fail = 0;
  let i = 0;

  for (const d of take) {
    i++;
    const res = await callFind(args.api, d, args.maxBuyersPerCompany, args.adminHeader, args.adminKey, args.dryRun);
    if (res.ok) {
      console.log(`✓ ${i}/${take.length} ${d} -> ${res.status}`);
      ok++;
    } else {
      // keep the first line of error to make logs compact
      const firstLine = (res.text || "").split("\n")[0];
      console.log(`✗ ${i}/${take.length} ${d} -> ${res.status} ${firstLine}`);
      fail++;
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  if (!args.dryRun && fail > 0) process.exit(2);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});