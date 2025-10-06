// scripts/find-buyers-batch.ts
//
// Batch: suppliers -> buyer leads
// Usage examples:
//   ts-node scripts/find-buyers-batch.ts --in data/companies.csv --api http://localhost:8787/api --city "San Diego"
//   ts-node scripts/find-buyers-batch.ts --in data/companies.json --api https://YOUR.code.run/api --key $ADMIN_KEY --concurrency 6
//
// Input formats:
//  CSV: columns can be host|website|domain|url|company_website
//  JSON array: [{ host:"acme.com" }, { website:"https://foo.com" }, ...]
//
// Outputs:
//  - out/find-buyers-YYYYMMDD-HHMM/  (one JSON per host)
//  - out/find-buyers-YYYYMMDD-HHMM/merged.json

import fs from "fs";
import path from "path";

type CompanyRec = Record<string, unknown>;
type PrefsPatch = {
  host: string;
  city?: string;
  general?: { mids?: boolean; near?: boolean; retail?: boolean; wholesale?: boolean; ecom?: boolean };
  likeTags?: string[];
  sizeWeight?: Record<string, number>;
  signalWeight?: Record<string, number>;
  inboundOptIn?: boolean;
};

function arg(flag: string, d?: string) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return d;
}
function has(flag: string) { return process.argv.includes(flag); }

const inPath = arg("--in") || arg("-i");
const apiBase = (arg("--api") || "").replace(/\/+$/,"");
const adminKey = arg("--key") || "";
const city = arg("--city") || "";                 // optional targeting city
const concurrency = Math.max(1, Number(arg("--concurrency") || 4));
const doPrefs = !has("--no-prefs");               // default: upsert demo prefs per host

if (!inPath || !apiBase) {
  console.error("Usage: ts-node scripts/find-buyers-batch.ts --in <companies.(csv|json)> --api <http://host:port/api> [--key ADMIN] [--city CITY] [--concurrency 4] [--no-prefs]");
  process.exit(2);
}

function read(p: string) { return fs.readFileSync(p, "utf8"); }
function mkdirp(p: string) { fs.mkdirSync(p, { recursive: true }); }

function normHost(s?: string): string {
  return String(s||"").toLowerCase().trim()
    .replace(/^https?:\/\//,"")
    .replace(/^www\./,"")
    .replace(/\/.*$/,"");
}

function extractHost(rec: CompanyRec): string {
  const keys = ["host","website","domain","url","company_website"];
  for (const k of keys) {
    if (rec[k] != null) {
      const h = normHost(String(rec[k]||""));
      if (h) return h;
    }
  }
  return "";
}

// --- tiny CSV ---
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q=false;
  for (let i=0;i<line.length;i++){
    const ch=line[i];
    if (ch === '"'){ if(q && line[i+1]==='"'){cur+='"'; i++;} else q=!q; }
    else if (ch === ',' && !q){ out.push(cur); cur=""; }
    else cur+=ch;
  }
  out.push(cur);
  return out.map(s=>s.trim());
}
function parseCsv(txt: string): CompanyRec[] {
  const lines = txt.replace(/\r/g,"").split("\n").filter(l=>l.trim().length>0);
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]);
  const rows: CompanyRec[] = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCsvLine(lines[i]);
    const rec: CompanyRec = {};
    for (let j=0;j<head.length;j++){ rec[head[j]] = cols[j] ?? ""; }
    rows.push(rec);
  }
  return rows;
}

function loadCompanies(file: string): string[] {
  const ext = path.extname(file).slice(1).toLowerCase();
  let rows: CompanyRec[] = [];
  if (ext === "csv") rows = parseCsv(read(file));
  else rows = JSON.parse(read(file));
  // If JSON is not array, try to unwrap {items:[...]}
  if (!Array.isArray(rows) && rows && Array.isArray((rows as any).items)) rows = (rows as any).items;
  const hosts = new Set<string>();
  for (const r of rows) {
    const h = extractHost(r);
    if (h) hosts.add(h);
  }
  return Array.from(hosts);
}

async function hit(method: string, path: string, body?: any, withKey=false) {
  const url = apiBase + path;
  const headers: Record<string,string> = { "Content-Type":"application/json" };
  if (withKey && adminKey) headers["x-admin-key"] = adminKey;
  const res = await fetch(url, { method, headers, body: body? JSON.stringify(body): undefined });
  const txt = await res.text();
  let data: any = txt; try { data = JSON.parse(txt); } catch {}
  return { ok: res.ok, status: res.status, data, url };
}

function demoPrefs(host: string): PrefsPatch {
  return {
    host,
    city: city || undefined,
    general: { mids:true, near: !!city, retail:true, wholesale:true, ecom:false },
    likeTags: ["film","labels","food","beverage"],
    sizeWeight: { micro:1.2, small:1.0, mid:0.6, large:-1.2 },
    signalWeight: { local: city ? 1.6 : 0.3, ecommerce:0.1, retail:0.35, wholesale:0.35 },
    inboundOptIn: true,
  };
}

async function upsertPrefs(host: string) {
  if (!doPrefs) return { ok:true, skipped:true };
  return hit("POST", "/prefs/upsert", demoPrefs(host), true);
}

async function findBuyers(host: string) {
  const q = new URLSearchParams({ host }); if (city) q.set("city", city);
  return hit("GET", "/leads/find-buyers?"+q.toString());
}

async function worker(hosts: string[], outDir: string, merged: any[]) {
  while (hosts.length) {
    const host = hosts.shift()!;
    try {
      if (doPrefs) {
        const p = await upsertPrefs(host);
        if (!p.ok) console.log(`[prefs] ${host} -> ${p.status} ${JSON.stringify(p.data)}`);
      }
      const r = await findBuyers(host);
      console.log(`[find] ${host} -> ${r.status}`);
      const item = { host, ok:r.ok, status:r.status, data:r.data };
      fs.writeFileSync(path.join(outDir, `${host.replace(/[^\w.-]/g,"_")}.json`), JSON.stringify(item, null, 2));
      merged.push(item);
    } catch (e:any) {
      console.log(`[err] ${host}: ${e?.message||e}`);
    }
  }
}

(async function main(){
  try{
    const hosts = loadCompanies(inPath!);
    if (!hosts.length) { console.error("No hosts extracted from input."); process.exit(2); }
    console.log(`Total distinct companies: ${hosts.length}`);

    const stamp = new Date().toISOString().replace(/[:.]/g,"-").slice(0,16);
    const outDir = path.join("out", `find-buyers-${stamp}`);
    mkdirp(outDir);

    const queue = hosts.slice();
    const merged: any[] = [];
    const workers: Promise<void>[] = [];
    for (let i=0;i<concurrency;i++){
      workers.push(worker(queue, outDir, merged));
    }
    await Promise.all(workers);

    fs.writeFileSync(path.join(outDir, "merged.json"), JSON.stringify({ items: merged }, null, 2));
    console.log(`Done. Output in ${outDir}`);
  }catch(e:any){
    console.error("Batch failed:", e?.message || e);
    process.exit(1);
  }
})();