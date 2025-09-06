#!/usr/bin/env ts-node

/**
 * scripts/seed-verticals.ts
 *
 * CLI to convert OPAL-exported CSVs (or JSON) into LeadSourceQuery records and
 * enqueue them for discovery. Works with either:
 *  - file-backed queue at data/lead-source-queue.ndjson (default)
 *  - a project module at src/lead-sources.ts exporting enqueueLeadSourceQueries()
 *
 * Usage:
 *   pnpm ts-node scripts/seed-verticals.ts seeds/*.csv --tenant TENANT_123 --source OPAL --region "Northeast"
 *   pnpm ts-node scripts/seed-verticals.ts --stdin --tenant TENANT_123
 */

import { promises as fs } from "fs";
import * as path from "path";
import * as crypto from "crypto";

type LeadSource = "OPAL" | "MANUAL" | "IMPORT" | "OTHER";

export interface LeadSourceQuery {
  id: string;
  tenantId: string;
  domain: string;
  name?: string;
  region?: string;
  reason?: string;
  signalUrl?: string | null;
  source: LeadSource;
  createdAt: string; // ISO
}

interface SeedOpts {
  tenantId: string;
  region?: string;
  source: LeadSource;
  adapter?: "file" | "module";
  queuePath?: string; // for file adapter
}

const DEFAULT_QUEUE = path.resolve(process.cwd(), "data/lead-source-queue.ndjson");

// ------------------------ CLI ARGS ------------------------

function parseArgs(argv = process.argv.slice(2)) {
  const files: string[] = [];
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) {
      const key = a.replace(/^--?/, "");
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    } else {
      files.push(a);
    }
  }
  return { files, opts };
}

// ------------------------ CSV PARSER ------------------------

/**
 * Minimal CSV parser that supports quoted fields and commas/newlines inside quotes.
 * Returns array of objects using the first row as headers.
 */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // Lookahead for escaped quote
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += c;
        i++;
        continue;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        row.push(field.trim());
        field = "";
        i++;
        continue;
      }
      if (c === "\n" || c === "\r") {
        // handle CRLF
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = "";
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }
  // last field
  if (field.length || row.length) {
    row.push(field.trim());
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const obj: Record<string, string> = {};
    const cells = rows[r];
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (cells[c] ?? "").trim();
    }
    // skip empty lines (no name/domain)
    if (Object.values(obj).join("").trim().length === 0) continue;
    out.push(obj);
  }
  return out;
}

// ------------------------ NORMALIZATION ------------------------

function toDomain(urlOrDomain: string): string {
  let raw = (urlOrDomain || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) {
    raw = "http://" + raw;
  }
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").toLowerCase();
  }
}

function stableId(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function mapRowToQuery(
  row: Record<string, string>,
  tenantId: string,
  fallbackRegion: string | undefined,
  source: LeadSource
): LeadSourceQuery | null {
  // Accept header variants: Name, Company, Website, URL, Domain, HQ/Region, Region, Reason, Signal
  const name =
    row["Name"] ||
    row["Company"] ||
    row["Company Name"] ||
    row["brand"] ||
    row["name"] ||
    "";
  const website =
    row["Website"] || row["URL"] || row["Domain"] || row["Site"] || row["website"] || "";
  const region = row["HQ/Region"] || row["Region"] || row["Location"] || fallbackRegion || "";
  const reason = row["Reason"] || row["Why"] || row["Notes"] || "";
  const signal = row["Signal"] || row["Signal Link"] || row["Source link"] || row["Source"] || "";

  const domain = toDomain(website || name);
  if (!domain) return null;

  const id = stableId(`${tenantId}:${domain}`);
  return {
    id,
    tenantId,
    domain,
    name: name || undefined,
    region: region || undefined,
    reason: reason || undefined,
    signalUrl: signal ? signal : null,
    source,
    createdAt: new Date().toISOString(),
  };
}

// ------------------------ ENQUEUE ------------------------

async function ensureDir(p: string) {
  await fs.mkdir(path.dirname(p), { recursive: true });
}

async function enqueueFile(queries: LeadSourceQuery[], queuePath = DEFAULT_QUEUE) {
  if (!queries.length) return 0;
  await ensureDir(queuePath);
  const lines = queries.map((q) => JSON.stringify(q)).join("\n") + "\n";
  await fs.appendFile(queuePath, lines, "utf8");
  return queries.length;
}

async function enqueueModule(queries: LeadSourceQuery[]) {
  try {
    // Expect a project module with this signature
    // export async function enqueueLeadSourceQueries(items: LeadSourceQuery[]): Promise<number>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import(path.resolve(process.cwd(), "src/lead-sources.ts")).catch(() =>
      import(path.resolve(process.cwd(), "src/lead-sources.js"))
    );
    if (typeof (mod as any).enqueueLeadSourceQueries !== "function") {
      throw new Error("src/lead-sources.{ts,js} missing enqueueLeadSourceQueries()");
    }
    return await (mod as any).enqueueLeadSourceQueries(queries);
  } catch (err) {
    console.warn(
      "[seed-verticals] Could not load src/lead-sources.{ts,js}; falling back to file queue.",
      (err as Error).message
    );
    return enqueueFile(queries);
  }
}

// ------------------------ MAIN ------------------------

async function readAllInputs(files: string[], stdin: boolean): Promise<string> {
  if (stdin) {
    const buf = await fs.readFile(0); // stdin fd
    return buf.toString("utf8");
  }
  if (!files.length) throw new Error("No input files. Pass CSV paths or --stdin.");
  const chunks: string[] = [];
  for (const f of files) {
    chunks.push(await fs.readFile(f, "utf8"));
  }
  return chunks.join("\n");
}

async function main() {
  const { files, opts } = parseArgs();
  const tenantId = String(opts["tenant"] || opts["tenantId"] || "").trim();
  if (!tenantId) throw new Error("--tenant TENANT_ID is required");

  const region = String(opts["region"] || "").trim() || undefined;
  const source = (String(opts["source"] || "OPAL").toUpperCase() as LeadSource) || "OPAL";
  const adapter = (String(opts["adapter"] || "file").toLowerCase() as "file" | "module") || "file";
  const queuePath = (opts["queue"] as string) || DEFAULT_QUEUE;
  const useStdin = Boolean(opts["stdin"]);

  const raw = await readAllInputs(files, useStdin);

  // Support JSON array as well as CSV
  let rows: Record<string, string>[];
  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json)) {
      rows = json as Record<string, string>[];
    } else {
      throw new Error("not array");
    }
  } catch {
    rows = parseCsv(raw);
  }

  const dedupe = new Set<string>();
  const queries: LeadSourceQuery[] = [];
  for (const r of rows) {
    const q = mapRowToQuery(r, tenantId, region, source);
    if (!q) continue;
    if (dedupe.has(q.domain)) continue;
    dedupe.add(q.domain);
    queries.push(q);
  }

  const count =
    adapter === "module"
      ? await enqueueModule(queries)
      : await enqueueFile(queries, queuePath);

  console.log(
    JSON.stringify(
      {
        ok: true,
        tenantId,
        source,
        region: region || null,
        input: { files, rows: rows.length },
        enqueued: count,
        adapter,
        queuePath: adapter === "file" ? queuePath : undefined,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2));
  process.exit(1);
});
