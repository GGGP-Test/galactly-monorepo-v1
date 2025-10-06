// Backend/scripts/find-buyers-batch.ts
//
// Batch importer that reads a CSV of “companies” in many possible formats,
// dedupes by domain, and calls the Artemis API to find buyers per company.
//
// No external deps. Works on Node 20+ (built-in fetch).
// Accepts both classic “company,domain,website” CSVs and CRM-style CSVs
// like: Email, Lead Status, First Name, Last Name, Company, Website, City, State, Country.
//
// Usage (local or in CI):
//   npx -y tsx ./scripts/find-buyers-batch.ts \
//     --csv app/Backend/data/companies.csv \
//     --api "$API_BASE" \
//     --adminHeader "x-admin-key" \
//     --adminToken "$ADMIN_TOKEN" \
//     --maxCompanies 0 \
//     --maxBuyers 30 \
//     --dryRun false
//
// Notes:
// - Defaults match our GitHub Actions workflow.
// - Logs each decision so you can see exactly why a row was skipped or posted.

import fs from "fs";
import path from "path";

type Row = Record<string, string>;

type FindBuyersPayload = {
  company?: string;
  domain?: string;
  website?: string;
  city?: string;
  state?: string;
  country?: string;
  max?: number; // buyers to request for this company
};

function arg(name: string, def = ""): string {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const env = process.env[name.replace(/-/g, "_").toUpperCase()];
  return (env ?? def) as string;
}

function argBool(name: string, def = false): boolean {
  const v = arg(name, def ? "true" : "false").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function argInt(name: string, def: number): number {
  const v = parseInt(arg(name, String(def)), 10);
  return Number.isFinite(v) ? v : def;
}

// --- config from args/env ---
const CSV_PATH = arg("csv", "app/Backend/data/companies.csv");
const API_BASE = (arg("api") || process.env.API_BASE || "").replace(/\/+$/, "");
const ADMIN_HEADER = arg("adminHeader", "x-admin-key");
const ADMIN_TOKEN = arg("adminToken", process.env.ADMIN_TOKEN || "");
const MAX_COMPANIES = argInt("maxCompanies", 0); // 0 = no limit
const MAX_BUYERS = argInt("maxBuyers", 30);
const DRY_RUN = argBool("dryRun", true);

// ---------------- CSV utils ----------------

function splitCSV(line: string): string[] {
  // split on commas not inside quotes
  const re = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/g;
  return line
    .split(re)
    .map((s) => s.replace(/^"(.*)"$/, "$1").trim());
}

function readCSV(filePath: string): Row[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = splitCSV(lines[0]).map((h) => h.trim());
  const lower = headers.map((h) => h.toLowerCase());

  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSV(lines[i]);
    const r: Row = {};
    for (let j = 0; j < headers.length; j++) {
      r[lower[j]] = (cols[j] ?? "").trim();
    }
    rows.push(r);
  }
  return rows;
}

function hostnameFromUrl(u?: string): string {
  if (!u) return "";
  try {
    const h = new URL(u.includes("://") ? u : `https://${u}`).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch {
    return (u || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.+$/, "").toLowerCase();
  }
}

function domainFromEmail(e?: string): string {
  const m = String(e || "").trim().match(/@([^>\s;]+)/);
  return m ? hostnameFromUrl(m[1]) : "";
}

// Accept many header variants
function pick(row: Row, ...cands: string[]): string {
  for (const c of cands) {
    const v = row[c.toLowerCase()];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function normalizeRow(row: Row): FindBuyersPayload | null {
  // Try to discover company + domain/website from various fields
  const company = pick(row, "company", "company name", "organization", "org", "business", "business name", "name");
  const websiteRaw = pick(row, "website", "site", "url", "landing page", "landing", "homepage");
  const email = pick(row, "email", "work email", "primary email", "contact email");
  const domain = pick(row, "domain", "root domain") || hostnameFromUrl(websiteRaw) || domainFromEmail(email);

  const website = websiteRaw ? (websiteRaw.startsWith("http") ? websiteRaw : `https://${websiteRaw}`) : (domain ? `https://${domain}` : "");

  const city = pick(row, "city", "town");
  const state = pick(row, "state", "region", "province", "state/region");
  const country = pick(row, "country", "country code", "nation");

  if (!domain && !website) {
    return null;
  }
  return {
    company: company || undefined,
    domain: domain || undefined,
    website: website || undefined,
    city: city || undefined,
    state: state || undefined,
    country: country || undefined,
    max: MAX_BUYERS,
  };
}

// --------------- HTTP -----------------

async function postFindBuyers(payload: FindBuyersPayload): Promise<{ ok: boolean; created?: number; reason?: string }> {
  const url = `${API_BASE}/api/leads/find`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [ADMIN_HEADER]: ADMIN_TOKEN,
    } as any,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, reason: `${res.status} ${res.statusText} ${txt.slice(0, 200)}` };
  }
  const data = await res.json().catch(() => ({}));
  const created = Number((data?.created ?? data?.count ?? 0));
  return { ok: true, created: Number.isFinite(created) ? created : undefined };
}

// --------------- main ------------------

async function main() {
  console.log("Importer starting…");
  console.log(`API_BASE=${API_BASE || "(missing)"}`);
  console.log(`adminHeader=${ADMIN_HEADER}`);
  console.log(`dryRun=${DRY_RUN}`);
  console.log(`maxCompanies=${MAX_COMPANIES}`);
  console.log(`maxBuyersPerCompany=${MAX_BUYERS}`);
  if (!API_BASE) throw new Error("API_BASE is required");
  if (!ADMIN_TOKEN) console.warn("WARN: adminToken missing; calls will fail auth.");

  const csvAbs = path.resolve(CSV_PATH);
  console.log(`CSV path: ${csvAbs}`);

  const rows = readCSV(csvAbs);
  console.log(`CSV rows: ${rows.length}`);

  const normalized: FindBuyersPayload[] = [];
  for (const r of rows) {
    const n = normalizeRow(r);
    if (!n) continue;
    normalized.push(n);
  }
  console.log(`Normalized rows (have domain/website): ${normalized.length}`);

  // Dedupe by domain (prefer rows that have company name)
  const byDomain = new Map<string, FindBuyersPayload>();
  for (const n of normalized) {
    const key = (n.domain || hostnameFromUrl(n.website || "") || "").toLowerCase();
    if (!key) continue;
    const prev = byDomain.get(key);
    if (!prev || (n.company && !prev.company)) byDomain.set(key, n);
  }
  let items = Array.from(byDomain.values());
  if (MAX_COMPANIES > 0) items = items.slice(0, MAX_COMPANIES);

  console.log(`Unique companies by domain: ${items.length}`);

  let ok = 0, fail = 0, createdTotal = 0;

  for (const it of items) {
    const label = `${it.company || it.domain || it.website}`;
    if (DRY_RUN) {
      console.log(`[DRY] would POST find-buyers for: ${label}`);
      continue;
    }
    const res = await postFindBuyers(it);
    if (res.ok) {
      ok++;
      createdTotal += res.created ?? 0;
      console.log(`[OK] ${label} -> created=${res.created ?? "n/a"}`);
    } else {
      fail++;
      console.log(`[ERR] ${label} -> ${res.reason}`);
    }
  }

  console.log("---- Summary ----");
  console.log(`Total unique companies: ${items.length}`);
  console.log(`Posted ok: ${ok}, failed: ${fail}, createdTotal: ${createdTotal}`);
  console.log("Importer done.");
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(2);
});