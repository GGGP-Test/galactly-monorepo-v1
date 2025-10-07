// Backend/scripts/find-buyers-batch.ts
// Batch "find buyers" importer that also logs events to /api/events/ingest.

/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import * as http from "node:http";
import * as https from "node:https";

type Row = Record<string, string>;

const env = (k: string, d = "") => (process.env[k] ?? d).toString();
const envBool = (k: string, d = false) =>
  /^(1|true|yes)$/i.test((process.env[k] ?? (d ? "true" : "false")).toString());
const envNum = (k: string, d = 0) => {
  const n = Number(process.env[k]); return Number.isFinite(n) ? n : d;
};

/* ----------------------------- CSV utilities ----------------------------- */

function readCSVFile(p: string): Row[] {
  const txt = fs.readFileSync(p, "utf8").replace(/\r/g, "");
  const lines = txt.split("\n").filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0].split(",").map(s => s.trim());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const r: Row = {};
    for (let j = 0; j < head.length; j++) r[head[j]] = (cols[j] ?? "").trim();
    rows.push(r);
  }
  return rows;
}

function findCSV(): string {
  const cwd = process.cwd();
  const requested = env("CSV_PATH", "data/companies.csv");
  const candidates = [
    requested,
    path.join("app/Backend", requested),
    "app/Backend/data/companies.csv",
    "Backend/data/companies.csv",
    "data/companies.csv",
    "companies.csv",
  ].map(p => path.resolve(cwd, p));
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error("CSV not found. Tried:\n" + candidates.map(p => " - " + p).join("\n"));
}

function uniq<T>(a: T[]) { return [...new Set(a.filter(Boolean))]; }

function domainFromRow(r: Row): string | null {
  const cands = [r.domain, r.Domain, r.website, r.Website, r.url, r.URL, r.email, r.Email].filter(Boolean) as string[];
  for (let v of cands) {
    v = v.trim(); if (!v) continue;
    if (v.includes("@")) { const d = v.split("@")[1]?.toLowerCase(); if (d) return d.replace(/^www\./, ""); }
    try {
      if (!/^https?:\/\//i.test(v)) v = "https://" + v;
      const u = new URL(v); return u.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return v.toLowerCase().replace(/^www\./, "");
    }
  }
  return null;
}

/* ------------------------------- HTTP utils ------------------------------ */

function getJSON(url: string, headers: Record<string, string>) {
  return new Promise<{ status: number; json?: any; text?: string }>((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request(u, { method: "GET", headers }, (res) => {
      let data = ""; res.setEncoding("utf8");
      res.on("data", ch => data += ch);
      res.on("end", () => {
        try { resolve({ status: res.statusCode || 0, json: JSON.parse(data || "{}") }); }
        catch { resolve({ status: res.statusCode || 0, text: data }); }
      });
    });
    req.on("error", reject); req.end();
  });
}

function postJSON(url: string, headers: Record<string, string>, body: any) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(JSON.stringify(body));
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request(u, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(payload.length), ...headers },
    }, (res) => {
      let data = ""; res.setEncoding("utf8");
      res.on("data", ch => data += ch);
      res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
    });
    req.on("error", reject); req.write(payload); req.end();
  });
}

/* --------------------------------- Main ---------------------------------- */

async function main() {
  const API_BASE = env("API_BASE").replace(/\/+$/, "");
  const ADMIN_TOKEN = env("ADMIN_TOKEN");
  const DRY_RUN = envBool("DRY_RUN", true);
  const LOG_EVENTS = envBool("LOG_EVENTS", true);

  const MAX_COMPANIES = envNum("MAX_COMPANIES", 0);
  const MAX_BUYERS = envNum("MAX_BUYERS_PER_COMPANY", 30);

  // Filters/preferences sent to /leads/find-buyers
  const TIERS = env("TIERS");                     // e.g. "C" or "B,C"
  const SIZE = env("SIZE").toLowerCase();         // small|medium|large
  const PREFER_TIER = env("PREFER_TIER").toUpperCase(); // A|B|C
  const PREFER_SIZE = env("PREFER_SIZE").toLowerCase(); // small|medium|large

  if (!API_BASE) throw new Error("API_BASE missing");

  const csvPath = findCSV();
  const rows = readCSVFile(csvPath);
  const domains = uniq(rows.map(domainFromRow) as (string | null)[] as string[]);
  const take = MAX_COMPANIES > 0 ? domains.slice(0, MAX_COMPANIES) : domains;

  console.log("Importer starting…");
  console.log("API_BASE=%s", API_BASE.replace(/^https?:\/\//, "").replace(/\/.*/, ""));
  console.log("dryRun=%s", DRY_RUN);
  console.log("CSV=%s", csvPath);
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
    if (TIERS) qp.push(`tiers=${encodeURIComponent(TIERS)}`); else if (SIZE) qp.push(`size=${encodeURIComponent(SIZE)}`);
    if (PREFER_TIER) qp.push(`preferTier=${encodeURIComponent(PREFER_TIER)}`); else if (PREFER_SIZE) qp.push(`preferSize=${encodeURIComponent(PREFER_SIZE)}`);
    const url = `${API_BASE}/leads/find-buyers?${qp.join("&")}`;

    const t0 = Date.now();
    if (DRY_RUN) {
      console.log(`≈ ${i + 1}/${take.length} ${d} (dryRun) -> ${url}`);
      if (LOG_EVENTS) {
        await postJSON(`${API_BASE}/events/ingest`, headers, {
          kind: "find_buyers",
          at: new Date().toISOString(),
          user: "batch",
          data: { host: d, dryRun: true, url },
        }).catch(() => {});
      }
      ok++;
      continue;
    }

    const res = await getJSON(url, headers);
    const ms = Date.now() - t0;

    if (res.status >= 200 && res.status < 300 && res.json?.ok !== false) {
      const sum = res.json?.summary || {};
      console.log(`✓ ${i + 1}/${take.length} ${d} -> ${res.status} returned=${sum.returned ?? "?"}`);
      if (LOG_EVENTS) {
        await postJSON(`${API_BASE}/events/ingest`, headers, {
          kind: "find_buyers",
          at: new Date().toISOString(),
          user: "batch",
          data: {
            host: d, summary: sum, ms,
            filters: { tiers: TIERS || null, size: SIZE || null, preferTier: PREFER_TIER || null, preferSize: PREFER_SIZE || null },
          },
        }).catch(() => {});
      }
      ok++;
    } else {
      const first = (res.text || JSON.stringify(res.json) || "").split("\n")[0];
      console.log(`✗ ${i + 1}/${take.length} ${d} -> ${res.status} ${first}`);
      if (LOG_EVENTS) {
        await postJSON(`${API_BASE}/events/ingest`, headers, {
          kind: "find_buyers_error",
          at: new Date().toISOString(),
          user: "batch",
          data: { host: d, status: res.status, firstLine: first },
        }).catch(() => {});
      }
      fail++;
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  if (!DRY_RUN && fail > 0) process.exit(2);
}

main().catch((e) => { console.error(e?.stack || e?.message || e); process.exit(1); });