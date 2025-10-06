// scripts/ads-import.ts
//
// Tiny importer for ad-intel rows -> /api/ads/bulk
// Usage:
//   ts-node scripts/ads-import.ts --in data/ads.csv --api http://localhost:8787/api --key YOUR_ADMIN_KEY
//   ts-node scripts/ads-import.ts --in data/ads.json --out bulk.json
//
// Input formats:
//  1) CSV with headers: host,platform,landing,seenAtISO,creativeUrl,text
//  2) JSON:
//     a) { items: [{ host, rows: [{platform,landing,seenAtISO,creativeUrl,text}, ...] }, ...] }
//     b) [{ host, rows: [...] }]  (array)
//     c) Flat rows with "host" field: [{ host, platform, landing, seenAtISO, ... }, ...]
//
// Notes:
// - No external deps. Node 18+ (global fetch).

import fs from "fs";
import path from "path";

type RawRow = {
  host?: string;
  platform?: string;
  landing?: string;
  seenAtISO?: string;
  creativeUrl?: string;
  text?: string;
};

type BulkItem = { host: string; rows: RawRow[] };
type BulkPayload = { items: BulkItem[] };

function arg(flag: string, dflt?: string) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return dflt;
}
function has(flag: string) {
  return process.argv.includes(flag);
}

const inPath = arg("--in") || arg("-i");
const apiBase = (arg("--api") || "").replace(/\/+$/,"");
const adminKey = arg("--key") || arg("--token") || "";
const outPath = arg("--out") || "bulk.json";
const assume = (arg("--assume") || "").toLowerCase(); // "csv"|"json" optional

if (!inPath) {
  console.error("Usage: ts-node scripts/ads-import.ts --in <file.(csv|json)> [--api http://host:port/api] [--key ADMIN] [--out bulk.json]");
  process.exit(2);
}

function readFile(p: string): string {
  return fs.readFileSync(p, "utf8");
}

// --- minimal CSV parser (handles quotes, commas; simple) ---
function parseCsv(txt: string): Record<string,string>[] {
  const rows: Record<string,string>[] = [];
  const lines = txt.replace(/\r/g, "").split("\n").filter(l => l.trim().length > 0);
  if (lines.length === 0) return rows;
  const head = splitCsvLine(lines[0]);
  for (let i=1;i<lines.length;i++){
    const cols = splitCsvLine(lines[i]);
    const rec: Record<string,string> = {};
    for (let j=0;j<head.length;j++){
      rec[head[j]] = (cols[j] ?? "").trim();
    }
    rows.push(rec);
  }
  return rows;
}
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i=0;i<line.length;i++){
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// --- normalization ---
function normHost(s?: string): string {
  return String(s||"").toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*$/,"").trim();
}
function toRowsFromCsv(recs: Record<string,string>[]): BulkPayload {
  // Expected headers: host,platform,landing,seenAtISO,creativeUrl,text
  const byHost = new Map<string, RawRow[]>();
  for (const r of recs) {
    const host = normHost(r.host);
    if (!host) continue;
    const row: RawRow = {
      platform: safeStr(r.platform),
      landing: safeStr(r.landing),
      seenAtISO: safeStr(r.seenAtISO),
      creativeUrl: safeStr(r.creativeUrl),
      text: safeStr(r.text),
    };
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host)!.push(row);
  }
  return { items: Array.from(byHost.entries()).map(([host, rows]) => ({ host, rows })) };
}
function safeStr(v: any): string | undefined {
  const s = (v == null ? "" : String(v)).trim();
  return s ? s : undefined;
}

function isBulkItems(obj: any): obj is BulkItem[] {
  return Array.isArray(obj) && obj.every(x => x && typeof x.host === "string" && Array.isArray(x.rows));
}
function isBulkPayload(obj: any): obj is BulkPayload {
  return obj && Array.isArray(obj.items);
}

function toRowsFromJson(obj: any): BulkPayload {
  // Accept {items:[...]} OR array of {host,rows} OR flat rows with host
  if (isBulkPayload(obj)) return obj;
  if (isBulkItems(obj)) return { items: obj };
  if (Array.isArray(obj)) {
    // Flat rows w/ host
    const byHost = new Map<string, RawRow[]>();
    for (const r of obj as any[]) {
      const host = normHost(r.host);
      if (!host) continue;
      const row: RawRow = {
        platform: safeStr(r.platform),
        landing: safeStr(r.landingUrl || r.landing),
        seenAtISO: safeStr(r.seenAtISO || r.lastSeen || r.firstSeen),
        creativeUrl: safeStr(r.creativeUrl),
        text: safeStr(r.text || r.creativeText),
      };
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host)!.push(row);
    }
    return { items: Array.from(byHost.entries()).map(([host, rows]) => ({ host, rows })) };
  }
  throw new Error("Unsupported JSON shape");
}

function loadPayload(inputPath: string): BulkPayload {
  const ext = (assume || path.extname(inputPath).slice(1).toLowerCase());
  if (ext === "csv") {
    const csv = parseCsv(readFile(inputPath));
    return toRowsFromCsv(csv);
  } else {
    const raw = readFile(inputPath);
    const obj = JSON.parse(raw);
    return toRowsFromJson(obj);
  }
}

async function postBulk(api: string, payload: BulkPayload, key?: string) {
  const url = api.replace(/\/+$/,"") + "/ads/bulk";
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  if (key) {
    headers["x-admin-key"] = key;
    headers["x-admin-token"] = key; // be liberal: support either header
  }
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const txt = await res.text();
  let data: any = txt;
  try { data = JSON.parse(txt); } catch {}
  return { ok: res.ok, status: res.status, data };
}

(async function main(){
  try {
    const payload = loadPayload(inPath!);

    if (!apiBase) {
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
      console.log(`Wrote ${outPath}. Example curl:`);
      console.log(`curl -X POST "${"http://YOUR-API/api/ads/bulk"}" \\`);
      console.log(`  -H "Content-Type: application/json" -H "x-admin-key: YOUR_KEY" \\`);
      console.log(`  --data @${outPath}`);
      process.exit(0);
    }

    const res = await postBulk(apiBase, payload, adminKey);
    console.log(`POST ${apiBase}/ads/bulk -> ${res.status}`);
    console.log(JSON.stringify(res.data, null, 2));
    if (!res.ok) process.exit(1);
  } catch (e: any) {
    console.error("Import failed:", e?.message || String(e));
    process.exit(1);
  }
})();
