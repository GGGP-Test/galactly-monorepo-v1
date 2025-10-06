// scripts/find-buyers-batch.ts
//
// Batch importer for “find buyers” by company.
// - Reads a CSV, dedupes by domain, and calls your backend with an admin header.
// - Zero external deps. Works on Node 20+ with `npx tsx`.
//
// Usage (env or flags):
//   npx -y tsx ./scripts/find-buyers-batch.ts \
//     --csv ./data/companies.csv \
//     --dryRun true \
//     --limit 50 \
//     --adminHeader x-admin-key \
//     --adminKey <SECRET> \
//     --apiBase https://<your-api>/api
//
// The GitHub Action passes: API_BASE, ADMIN_KEY_NAME, ADMIN_KEY_VALUE, DRY_RUN, MAX_COMPANIES

type Row = Record<string, string>;

function env(name: string, def = ""): string {
  const v = process.env[name];
  return (v == null ? def : String(v)).trim();
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] || "";
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = (argv[i + 1] || "").startsWith("--") ? "true" : (argv[i + 1] || "");
      if (!(argv[i + 1] || "").startsWith("--")) i++;
      out[k] = v;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const API_BASE = (args.apiBase || env("API_BASE")).replace(/\/+$/, "") || "";
const CSV_PATH = args.csv || "./data/companies.csv";
const DRY_RUN = /^(1|true|yes)$/i.test(args.dryRun || env("DRY_RUN", "false"));
const LIMIT = Number(args.limit || env("MAX_COMPANIES", "0")) || 0;
const ADMIN_HEADER = args.adminHeader || env("ADMIN_KEY_NAME", "x-admin-key");
const ADMIN_KEY = args.adminKey || env("ADMIN_KEY_VALUE", "");

if (!API_BASE) {
  console.error("API_BASE is required (e.g. https://.../api)");
  process.exit(1);
}
if (!ADMIN_KEY && !DRY_RUN) {
  console.error("ADMIN key missing. Set --adminKey or ADMIN_KEY_VALUE.");
  process.exit(1);
}

function readText(p: string): string {
  const fs = require("fs");
  return fs.readFileSync(p, "utf8");
}

// Tiny CSV parser that supports quoted fields and commas inside quotes.
function parseCSV(txt: string): Row[] {
  const lines = txt.replace(/\r/g, "").split("\n").filter(l => l.length > 0);
  if (!lines.length) return [];
  const headers = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const r: Row = {};
    for (let j = 0; j < headers.length; j++) {
      r[headers[j]] = (cols[j] ?? "").trim();
    }
    rows.push(r);
  }
  return rows;
}

function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else { q = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function lowerKeys<T extends Record<string, any>>(r: T): Record<string, any> {
  const o: Record<string, any> = {};
  for (const k of Object.keys(r)) o[k.toLowerCase()] = r[k];
  return o;
}

function domainFromUrlOrEmail(s?: string): string {
  if (!s) return "";
  const v = String(s).trim();
  // If looks like email, use part after @
  const at = v.indexOf("@");
  if (at > 0 && at < v.length - 1) return v.slice(at + 1).toLowerCase();
  // Else try url
  try {
    const h = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch { return v.toLowerCase().replace(/^www\./, ""); }
}

function pickDomain(row: Row): string {
  const r = lowerKeys(row);
  return (
    r["domain"] ||
    domainFromUrlOrEmail(r["website"]) ||
    domainFromUrlOrEmail(r["url"]) ||
    domainFromUrlOrEmail(r["company website"]) ||
    domainFromUrlOrEmail(r["email"]) ||
    ""
  );
}

function pickCompany(row: Row): string {
  const r = lowerKeys(row);
  return (
    r["company"] ||
    r["company name"] ||
    r["organization"] ||
    r["org"] ||
    ""
  );
}

function pickCity(row: Row): string {
  const r = lowerKeys(row);
  return r["city"] || r["location"] || r["hq city"] || "";
}

async function main() {
  console.log("Importer starting…");
  console.log(`API_BASE=${API_BASE}`);
  console.log(`dryRun=${DRY_RUN} limit=${LIMIT}`);

  const txt = readText(CSV_PATH);
  const rows = parseCSV(txt);
  if (!rows.length) {
    console.error("CSV appears empty:", CSV_PATH);
    process.exit(1);
  }

  // Normalize + dedupe by domain
  const byDomain = new Map<string, { domain: string; company: string; city?: string }>();
  for (const raw of rows) {
    const domain = pickDomain(raw);
    if (!domain) continue;
    const company = pickCompany(raw) || domain;
    const city = pickCity(raw) || undefined;
    if (!byDomain.has(domain)) byDomain.set(domain, { domain, company, city });
  }

  const items = Array.from(byDomain.values());
  const total = items.length;
  const slice = LIMIT > 0 ? items.slice(0, LIMIT) : items;

  console.log(`Unique companies (by domain): ${total}. Processing: ${slice.length}`);

  let ok = 0, fail = 0;
  for (let i = 0; i < slice.length; i++) {
    const it = slice[i];
    const body = {
      company: it.company,
      domain: it.domain,
      city: it.city || undefined,
      // tuner knobs for backend (safe to ignore if backend doesn’t use them)
      maxBuyers: 30
    };

    if (DRY_RUN) {
      console.log(`[dry] ${i + 1}/${slice.length} ->`, body);
      ok++;
      continue;
    }

    try {
      const url = `${API_BASE}/leads/find`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ADMIN_HEADER]: ADMIN_KEY
        } as any,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error(`✗ ${i + 1}/${slice.length} ${it.domain} -> ${res.status} ${t}`);
        fail++;
      } else {
        const d = await res.json().catch(() => ({}));
        console.log(`✓ ${i + 1}/${slice.length} ${it.domain} -> ok`, (d && d.count != null) ? `(${d.count})` : "");
        ok++;
      }
    } catch (e: any) {
      console.error(`✗ ${i + 1}/${slice.length} ${it.domain} ->`, e?.message || e);
      fail++;
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  if (fail > 0) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});