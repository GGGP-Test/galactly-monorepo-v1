// src/utils/seeds-loader.ts
import fs from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import * as readline from "node:readline";

export type SeedRow = {
  name: string;
  website: string;
  region?: string;
  vertical?: string;
  reason?: string;    // “Likely packaging used”
  signal?: string;    // “Recent signal”
  source?: string;    // URL
};

function parseRow(cols: string[]): SeedRow | null {
  // Expected headers (order-insensitive): Name, Website, HQ/Region, Vertical,
  // Likely packaging used (1 line), Recent signal (1 line), Source link
  if (cols.length < 2) return null;
  const [name, website, region, vertical, reason, signal, source] =
    cols.map(s => (s ?? "").trim());
  if (!name || !website) return null;
  return { name, website, region, vertical, reason, signal, source };
}

async function parseCSV(text: string): Promise<SeedRow[]> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  // Split CSV very simply (assumes no embedded commas in quoted fields; if you need that,
  // swap to a CSV lib like 'csv-parse' later)
  const out: SeedRow[] = [];
  const start = lines[0].toLowerCase().includes("name,") ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim());
    const row = parseRow(cols);
    if (row) out.push(row);
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow" as any });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  return await res.text();
}

function base64Gunzip(b64: string): Promise<string> {
  const input = Buffer.from(b64, "base64");
  const source = Readable.from(input);
  const unzip = createGunzip();
  const chunks: Buffer[] = [];
  const sink = new (class extends Readable {
    _read() {}
  })();
  unzip.on("data", (c) => chunks.push(c));
  return pipeline(source, unzip).then(() => Buffer.concat(chunks).toString("utf8"));
}

export async function loadSeeds(): Promise<SeedRow[]> {
  // Priority: explicit file path → URL → base64 (gz) → plain base64 → plain env CSV
  const filePath = process.env.SEEDS_FILE || "/run/secrets/seeds.csv";
  const url = process.env.SEEDS_URL;
  const b64 = process.env.SEEDS_CSV_B64;
  const raw = process.env.SEEDS_CSV;

  let csv: string | null = null;

  try {
    const buf = await fs.readFile(filePath);
    csv = buf.toString("utf8");
  } catch {}

  if (!csv && url) {
    csv = await fetchText(url);
  }

  if (!csv && b64) {
    try {
      csv = await base64Gunzip(b64);
    } catch {
      // maybe it wasn't gzipped
      csv = Buffer.from(b64, "base64").toString("utf8");
    }
  }

  if (!csv && raw) {
    csv = raw;
  }

  if (!csv) return [];

  const rows = await parseCSV(csv);
  // Deduplicate by website (domain)
  const seen = new Set<string>();
  return rows.filter(r => {
    const key = (r.website || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/+.*/, "");
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
