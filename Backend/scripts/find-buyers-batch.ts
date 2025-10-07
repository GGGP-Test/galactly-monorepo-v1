// Backend/scripts/find-buyers-batch.ts
//
// Private batch importer for your seeds CSV.
// Calls **GET /api/leads/find-buyers** (no POST fallback).
// Supports per-run tier controls via env.
//
// Env (set by GitHub Actions or locally):
//   API_BASE              e.g. https://<host>/api   (required)
//   ADMIN_TOKEN           optional; sent as x-admin-key
//   CSV_PATH              default: app/Backend/data/companies.csv
//   DRY_RUN               "true"|"false" (default "true")
//   MAX_COMPANIES         "0" = all (default 0)
//   MAX_BUYERS_PER_COMPANY default 30
//   TIERS                 e.g. "C" or "B,C" (hard filter)
//   SIZE                  alias for TIERS: small|medium|large -> C|B|A
//   PREFER_TIER           A|B|C (boost that tier)
//   PREFER_SIZE           alias for PREFER_TIER: small|medium|large
//
// Usage (local example):
//   API_BASE=https://host/api ADMIN_TOKEN=xxxx DRY_RUN=true \
//   tsx Backend/scripts/find-buyers-batch.ts

/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import * as https from "node:https";

type Row = Record<string, string>;

function env(k: string, d = ""): string {
  const v = process.env[k];
  return v == null || v === "" ? d : String(v);
}
function envBool(k: string, d = false): boolean {
  const v = env(k, d ? "true" : "false").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
function envNum(k: string, d = 0): number {
  const n = Number(env(k, String(d)));
  return Number.isFinite(n) ? n : d;
}

function readCSV(filePath: string): Row[] {
  const txt = fs.readFileSync(filePath, "utf8").replace(/\r/g, "");
  const lines = txt.split("\n").filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(","); // simple CSV (no embedded commas)
    const r: Row = {};
    for (let j = 0; j < header.length; j++) r[header[j]] = (cols[j] ?? "").trim();
    rows.push(r);
  }
  return rows;
}

function uniq<T>(arr: T[]): T[] {
  const s = new Set<T>();
  for (const v of arr) if (v != null) s.add(v);
  return [...s];
}

function domainFromRow(r: Row): string | null {
  const cands = [
    r.domain, r.Domain, r.DOMAIN,
    r.website, r.Website, r.url, r.URL, r.homepage,
    r.Email, r.email,
  ].filter(Boolean) as string[];

  for (const v0 of cands) {
    let v = v0.trim();
    if (!v) continue;

    // email -> domain
    if (v.includes("@")) {
      const d = v.split("@")[1]?.trim().toLowerCase();
      if (d) return d.replace(/^www\./, "");
    }

    // plain URL or bare domain
    try {
      if (!/^https?:\/\//i.test(v)) v = "https://" + v;
      const u = new URL(v);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host) return host;
    } catch {
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return v.replace(/^www\./, "").toLowerCase();
    }
  }
  return null;
}

function getJSON(url: string, headers: Record<string, string>): Promise<{ status: number; json?: any; text?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(u, { method: "GET", headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (ch) => (data += ch));
      res.on("end", () => {
        try { resolve({ status: res.statusCode || 0, json: JSON.parse(data || "{}") }); }
        catch { resolve({ status: res.statusCode || 0, text: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const API_BASE = env("API_BASE").replace(/\/+$/, "");
  const ADMIN_TOKEN = env("ADMIN_TOKEN");
  const CSV_PATH = path.resolve(env("CSV_PATH", "app/Backend/data/companies.csv"));
  const DRY_RUN = envBool("DRY_RUN", true);
  const MAX_COMPANIES = envNum("MAX_COMPANIES", 0);
  const MAX_BUYERS = envNum("MAX_BUYERS_PER_COMPANY", 30);

  const TIERS = env("TIERS");               // e.g. "C" or "B,C"
  const SIZE  = env("SIZE").toLowerCase();  // small|medium|large
  const PREFER_TIER = env("PREFER_TIER").toUpperCase(); // A|B|C
  const PREFER_SIZE = env("PREFER_SIZE").toLowerCase(); // small|medium|large

  if (!API_BASE) throw new Error("API_BASE missing");
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);

  const rows = readCSV(CSV_PATH);
  const domains = uniq(rows.map(domainFromRow).filter(Boolean) as string[]);
  const take = MAX_COMPANIES > 0 ? domains.slice(0, MAX_COMPANIES) : domains;

  console.log("Importer starting…");
  console.log("API_BASE=%s", API_BASE.replace(/^https?:\/\//, "").replace(/\/.*/, ""));
  console.log("dryRun=%s", DRY_RUN);
  console.log(`Unique companies (by domain): ${domains.length}. Processing: ${take.length}`);

  const headers: Record<string, string> = { accept: "application/json" };
  if (ADMIN_TOKEN) headers["x-admin-key"] = ADMIN_TOKEN;

  let ok = 0, fail = 0;

  for (let i = 0; i < take.length; i++) {
    const d = take[i];

    const qp: string[] = [
      `host=${encodeURIComponent(d)}`,
      `limit=${encodeURIComponent(String(Math.max(0, MAX_BUYERS)))}`,
    ];

    // hard filter
    if (TIERS) qp.push(`tiers=${encodeURIComponent(TIERS)}`);
    else if (SIZE) qp.push(`size=${encodeURIComponent(SIZE)}`);

    // prefer
    if (PREFER_TIER) qp.push(`preferTier=${encodeURIComponent(PREFER_TIER)}`);
    else if (PREFER_SIZE) qp.push(`preferSize=${encodeURIComponent(PREFER_SIZE)}`);

    const url = `${API_BASE}/leads/find-buyers?${qp.join("&")}`;

    if (DRY_RUN) {
      console.log(`≈ ${i + 1}/${take.length} ${d} (dryRun) -> ${url}`);
      ok++;
      continue;
    }

    const res = await getJSON(url, headers);
    if (res.status >= 200 && res.status < 300 && res.json?.ok !== false) {
      const ret = res.json?.summary?.returned ?? "?";
      console.log(`✓ ${i + 1}/${take.length} ${d} -> ${res.status} returned=${ret}`);
      ok++;
    } else {
      const first = (res.text || JSON.stringify(res.json) || "").split("\n")[0];
      console.log(`✗ ${i + 1}/${take.length} ${d} -> ${res.status} ${first}`);
      fail++;
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  if (!DRY_RUN && fail > 0) process.exit(2);
}

main().catch((e) => { console.error(e?.stack || e?.message || e); process.exit(1); });