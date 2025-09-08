// src/leadgen/seeding/seed-pacs.ts
/**
 * c-pacs.ts — Curated Packs loader (CSV/JSON) + utilities
 * Use this to seed vertical/region lead lists created by OPAL or manual curation.
 *
 * Expected CSV headers (case-insensitive):
 *   brand, domain, region, tags, evidence1, evidence2, source, weight
 *
 * JSON format:
 *   {
 *     "id": "meal-kits-us-v1",
 *     "title": "Meal Kits — US (v1)",
 *     "vertical": "meal_kits",
 *     "region": "us",
 *     "version": "v1",
 *     "items": [{ brand, domain, region?, tags?, evidence?, source?, weight? }]
 *   }
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

export type Vertical =
  | "ecommerce_food" | "meal_kits" | "cosmetics" | "supplements"
  | "beverages" | "pet" | "household" | "industrial_b2b"
  | "pharma_otc" | "apparel" | string;

export interface SeedPackEntry {
  brand?: string;
  domain: string;
  region?: string;
  tags?: string[];
  evidence?: string[]; // up to 4 items recommended
  source?: string;     // e.g., "opal:workflow-123", "yelp", "manual"
  weight?: number;     // 0..1 preference weight
}

export interface SeedPack {
  id: string;
  title: string;
  vertical: Vertical;
  region?: string;
  version: string;
  items: SeedPackEntry[];
  createdAt?: string; // ISO
  notes?: string;
}

export interface LoaderOptions {
  dir?: string;          // folder with CSV/JSON packs
  files?: string[];      // explicit list
  merge?: boolean;       // merge into one pack if multiple inputs
  id?: string;           // id to assign when merge=true
  vertical?: Vertical;   // override vertical when merge=true
  region?: string;       // override region when merge=true
  version?: string;      // override version when merge=true
  excludeDomains?: string[];
  dedupeByDomain?: boolean; // default true
  minWeight?: number;       // filter
  mustTags?: string[];
  mustNotTags?: string[];
}

export interface LoadResult {
  packs: SeedPack[];
  merged?: SeedPack;
}

// ---------------------------- Core API ----------------------------

export async function loadCPacs(opts: LoaderOptions): Promise<LoadResult> {
  const files = await resolveFiles(opts);
  const packs: SeedPack[] = [];
  for (const file of files) {
    const pack = await loadPackFromFile(file);
    packs.push(cleanPack(pack, opts));
  }

  if (opts.merge) {
    const merged = mergePacks(packs, {
      id: opts.id || inferMergedId(packs),
      title: packs.length === 1 ? packs[0].title : "Merged curated pack",
      vertical: opts.vertical || packs[0]?.vertical || "unknown",
      region: opts.region || packs[0]?.region,
      version: opts.version || packs[0]?.version || "v1",
    }, opts);
    return { packs, merged };
  }
  return { packs };
}

export async function savePack(filePath: string, pack: SeedPack) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(pack, null, 2), "utf8");
}

export function toNDJSON(items: SeedPackEntry[]): string {
  return items.map(i => JSON.stringify(i)).join("\n");
}

export function getSeeds(pack: SeedPack, limit = 200): SeedPackEntry[] {
  return pack.items.slice(0, limit);
}

// -------------------------- Helpers -------------------------------

async function resolveFiles(opts: LoaderOptions): Promise<string[]> {
  if (opts.files?.length) return opts.files;
  const dir = opts.dir || path.resolve(process.cwd(), "data/seed-packs");
  if (!fs.existsSync(dir)) return [];
  const cand = await fsp.readdir(dir);
  return cand
    .filter(n => /\.(csv|json)$/i.test(n))
    .map(n => path.join(dir, n));
}

async function loadPackFromFile(file: string): Promise<SeedPack> {
  const ext = path.extname(file).toLowerCase();
  const raw = await fsp.readFile(file, "utf8");
  if (ext === ".json") {
    const j = JSON.parse(raw);
    assertPack(j, file);
    return j;
  }
  if (ext === ".csv") {
    const items = parseCSVToItems(raw);
    const { name } = path.parse(file);
    const inferred = inferMetaFromName(name);
    const pack: SeedPack = {
      id: inferred.id,
      title: inferred.title,
      vertical: inferred.vertical,
      region: inferred.region,
      version: inferred.version,
      items,
      createdAt: new Date().toISOString(),
      notes: `Imported from CSV: ${path.basename(file)}`,
    };
    return pack;
  }
  throw new Error(`Unsupported file: ${file}`);
}

function assertPack(j: any, file: string) {
  if (!j || typeof j !== "object") throw new Error(`Bad JSON: ${file}`);
  for (const k of ["id", "title", "vertical", "version", "items"]) {
    if (!j[k]) throw new Error(`Missing ${k} in ${file}`);
  }
  if (!Array.isArray(j.items)) throw new Error(`items must be array in ${file}`);
}

function parseCSVToItems(csv: string): SeedPackEntry[] {
  const rows = csvParse(csv);
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const items: SeedPackEntry[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const domain = normalizeDomain(row[idx("domain")] || row[idx("website")] || "");
    if (!domain) continue;
    const brand = row[idx("brand")] || undefined;
    const region = row[idx("region")] || undefined;
    const tags = splitTags(row[idx("tags")] || "");
    const evidence = [row[idx("evidence1")], row[idx("evidence2")], row[idx("evidence3")], row[idx("evidence4")]]
      .filter(Boolean) as string[];
    const source = row[idx("source")] || "csv";
    const weight = safeNum(row[idx("weight")], 1);

    items.push({ brand, domain, region, tags, evidence, source, weight });
  }
  return items;
}

function splitTags(s: string): string[] {
  if (!s) return [];
  return s.split(/[|,;]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
}

function normalizeDomain(input: string): string {
  if (!input) return "";
  try {
    const u = input.includes("://") ? new URL(input) : new URL("https://" + input);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    // maybe it's just a host
    return input.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}

function safeNum(v: any, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function inferMetaFromName(name: string): { id: string; title: string; vertical: Vertical; region?: string; version: string } {
  // e.g., "meal-kits-us-v1"
  const parts = name.split(/[_\-]+/);
  let vertical = parts[0] || "unknown";
  let region = parts.find(p => ["us", "ca", "uk", "eu"].includes(p));
  let version = (parts.find(p => /^v\d+$/i.test(p)) || "v1").toLowerCase();
  const id = `${vertical}-${region || "global"}-${version}`;
  const title = `${pretty(vertical)} — ${(region || "global").toUpperCase()} (${version})`;
  return { id, title, vertical, region, version };
}

function pretty(s: string): string {
  return s.replace(/[_\-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function cleanPack(pack: SeedPack, opts: LoaderOptions): SeedPack {
  const seen = new Set<string>();
  const exclude = new Set((opts.excludeDomains || []).map(d => d.toLowerCase()));
  const dedupe = opts.dedupeByDomain !== false;
  const minWeight = opts.minWeight ?? 0;
  const mustTags = new Set((opts.mustTags || []).map(t => t.toLowerCase()));
  const mustNotTags = new Set((opts.mustNotTags || []).map(t => t.toLowerCase()));

  const items = pack.items.filter(it => {
    const d = (it.domain || "").toLowerCase();
    if (!d || exclude.has(d)) return false;
    if (dedupe) {
      if (seen.has(d)) return false;
      seen.add(d);
    }
    if (it.weight !== undefined && it.weight < minWeight) return false;
    if (mustTags.size && !hasAny(it.tags || [], mustTags)) return false;
    if (mustNotTags.size && hasAny(it.tags || [], mustNotTags)) return false;
    return true;
  });
  return { ...pack, items };
}

function hasAny(arr: string[], set: Set<string>) {
  for (const a of arr) if (set.has(a.toLowerCase())) return true;
  return false;
}

function mergePacks(packs: SeedPack[], meta: Partial<SeedPack>, opts: LoaderOptions): SeedPack {
  const acc: Record<string, SeedPackEntry> = {};
  for (const p of packs) {
    for (const item of p.items) {
      const key = item.domain.toLowerCase();
      const prev = acc[key];
      if (!prev) {
        acc[key] = { ...item };
      } else {
        acc[key] = {
          brand: prev.brand || item.brand,
          domain: key,
          region: prev.region || item.region,
          tags: dedupArr([...(prev.tags || []), ...(item.tags || [])]),
          evidence: dedupArr([...(prev.evidence || []), ...(item.evidence || [])]).slice(0, 4),
          source: dedupArr([prev.source || "", item.source || ""]).filter(Boolean).join(","),
          weight: Math.max(prev.weight ?? 1, item.weight ?? 1),
        };
      }
    }
  }
  const merged: SeedPack = {
    id: meta.id || "merged-pack",
    title: meta.title || "Merged Curated Pack",
    vertical: (meta.vertical as Vertical) || packs[0]?.vertical || "unknown",
    region: meta.region || packs[0]?.region,
    version: meta.version || "v1",
    items: Object.values(acc),
    createdAt: new Date().toISOString(),
  };
  return cleanPack(merged, opts);
}

function dedupArr<T>(arr: T[]): T[] {
  const s = new Set<any>();
  const out: T[] = [];
  for (const x of arr) {
    const k = (typeof x === "string" ? (x as unknown as string).toLowerCase() : JSON.stringify(x));
    if (s.has(k)) continue;
    s.add(k);
    out.push(x);
  }
  return out;
}
