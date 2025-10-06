// Backend/scripts/find-buyers-batch.ts
//
// Batch "Find buyers" runner for a CSV of companies.
// - Reads ./data/companies.csv (or a path from argv[2])
// - Dedupes by normalized domain
// - POSTs each to your buyers API (same endpoint the Admin button uses)
// - Writes JSON + CSV summaries to ./data/out/
//
// Usage:
//   npm run build
//   API_BASE="https://<api-host>" ADMIN_KEY="<key>" \
//   node dist/scripts/find-buyers-batch.js ./data/companies.csv
//
// Env:
//   API_BASE     -> defaults to http://127.0.0.1:8787
//   ADMIN_KEY    -> sent as x-admin-key (if your API expects it)
//   FIND_ENDPOINT -> defaults to /api/leads/find
//
// CSV columns supported (case-insensitive): company, website, domain, email, city, state, country

import fs from "fs";
import path from "path";
import os from "os";

type Row = Record<string, string>;

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:8787").replace(/\/+$/,"");
const ENDPOINT = process.env.FIND_ENDPOINT || "/api/leads/find";
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.X_ADMIN_KEY || "";

function norm(s?: string) { return String(s ?? "").trim(); }
function lc(s?: string) { return String(s ?? "").toLowerCase(); }

function normHost(input?: string): string {
  const s = (input || "").trim();
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    return u.hostname.toLowerCase().replace(/^www\./,"");
  } catch {
    // maybe it's an email
    const at = s.indexOf("@");
    if (at > 0) return s.slice(at + 1).toLowerCase().replace(/^www\./,"");
    // maybe it's just a bare domain
    return s.toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*$/,"");
  }
}

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else { q = !q; }
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

function readCSV(p: string): Row[] {
  const txt = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const lines = txt.split("\n").filter(l => l.trim().length);
  if (!lines.length) return [];
  const header = parseCSVLine(lines[0]).map(lc);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const r: Row = {};
    header.forEach((h, idx) => { r[h] = vals[idx] ?? ""; });
    rows.push(r);
  }
  return rows;
}

type InputCompany = {
  company?: string;
  website?: string;
  email?: string;
  city?: string;
  state?: string;
  country?: string;
  host: string; // normalized landing/biz domain
};

function toInput(row: Row): InputCompany | null {
  const company = row["company"] || row["name"] || "";
  const website = row["website"] || row["url"] || row["domain"] || "";
  const email = row["email"] || "";
  const city = row["city"] || "";
  const state = row["state"] || row["region"] || "";
  const country = row["country"] || row["country_code"] || "";

  const host = normHost(website || email);
  if (!host) return null;

  return {
    company: norm(company),
    website: norm(website),
    email: norm(email),
    city: norm(city),
    state: norm(state),
    country: norm(country),
    host,
  };
}

async function postFindBuyers(item: InputCompany): Promise<any> {
  const url = API_BASE + ENDPOINT;
  const body = {
    host: item.host,
    company: item.company,
    website: item.website || ("https://" + item.host),
    city: item.city || undefined,
    state: item.state || undefined,
    country: item.country || undefined,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ADMIN_KEY ? { "x-admin-key": ADMIN_KEY } : {}),
    },
    body: JSON.stringify(body),
  });
  let data: any = {};
  try { data = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, data };
}

async function main() {
  const csvArg = process.argv[2] || "./data/companies.csv";
  const csvPath = path.resolve(csvArg);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(2);
  }

  const outDir = path.resolve("./data/out");
  fs.mkdirSync(outDir, { recursive: true });

  const raw = readCSV(csvPath);
  const inputs = raw.map(toInput).filter(Boolean) as InputCompany[];

  // dedupe by host
  const seen = new Set<string>();
  const unique = inputs.filter(x => {
    const k = x.host;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  console.log(`Loaded ${raw.length} rows → ${unique.length} unique companies`);
  console.log(`API: ${API_BASE}${ENDPOINT}`);

  const results: Array<{
    host: string;
    company?: string;
    ok: boolean;
    status: number;
    buyersFound?: number;
    error?: string;
  }> = [];

  // simple concurrency
  const CONC = Math.max(1, Number(process.env.CONCURRENCY || 4));
  let idx = 0;

  async function worker(id: number) {
    while (idx < unique.length) {
      const i = idx++;
      const item = unique[i];
      try {
        const r = await postFindBuyers(item);
        const buyersFound =
          (typeof r?.data?.count === "number" && r.data.count) ||
          (Array.isArray(r?.data?.rows) ? r.data.rows.length : undefined) ||
          (Array.isArray(r?.data?.buyers) ? r.data.buyers.length : undefined);

        results.push({
          host: item.host,
          company: item.company,
          ok: !!r.ok,
          status: r.status,
          buyersFound,
          error: r.ok ? undefined : String(r?.data?.error || "request_failed"),
        });

        const tag = r.ok ? "OK" : "ERR";
        console.log(`[${tag}] ${item.host}  buyers=${buyersFound ?? "-"}  (${i + 1}/${unique.length})`);
      } catch (e: any) {
        results.push({
          host: item.host,
          company: item.company,
          ok: false,
          status: 0,
          error: String(e?.message || e),
        });
        console.log(`[ERR] ${item.host} ${String(e?.message || e)}`);
      }
    }
  }

  const workers = Array.from({ length: CONC }, (_, i) => worker(i));
  await Promise.all(workers);

  // write outputs
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outJSON = path.join(outDir, `buyers-run-${ts}.json`);
  const outCSV  = path.join(outDir, `buyers-run-${ts}.csv`);

  fs.writeFileSync(outJSON, JSON.stringify({ api: API_BASE + ENDPOINT, results }, null, 2), "utf8");

  const csvLines = [
    ["host","company","ok","status","buyersFound","error"].join(","),
    ...results.map(r => [
      r.host,
      (r.company || "").replace(/,/g," "),
      r.ok ? "1" : "0",
      String(r.status),
      r.buyersFound == null ? "" : String(r.buyersFound),
      (r.error || "").replace(/[\r\n,]+/g," ").slice(0,200)
    ].join(","))
  ];
  fs.writeFileSync(outCSV, csvLines.join(os.EOL), "utf8");

  const okCount = results.filter(r => r.ok).length;
  const sumBuyers = results.reduce((a,b) => a + (b.buyersFound || 0), 0);

  console.log(`\nDone. OK=${okCount}/${results.length}  buyersFound=${sumBuyers}`);
  console.log(`Wrote:\n  ${outJSON}\n  ${outCSV}`);
}

main().catch(e => { console.error(e); process.exit(1); });