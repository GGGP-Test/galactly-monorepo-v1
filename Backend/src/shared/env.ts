// src/shared/env.ts
//
// One place for typed, clamped env + cost guardrails defaults.
// Routers import this (no side effects).
//
// You already set most of these keys in Northflank. This file just
// parses, validates and exposes them in a safe, typed object.

import fs from "node:fs";
import path from "node:path";

// ---------- helpers ----------
function toBool(v: string | undefined, d = false): boolean {
  if (!v) return d;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function toNum(
  v: string | undefined,
  d: number,
  min?: number,
  max?: number
): number {
  let n = Number(v);
  if (!Number.isFinite(n)) n = d;
  if (min !== undefined && n < min) n = min;
  if (max !== undefined && n > max) n = max;
  return n;
}

function str(v: string | undefined, d = ""): string {
  const s = (v ?? d).toString().trim();
  return s;
}

function tiersSet(csv: string | undefined): Set<"A" | "B" | "C"> {
  const raw = (csv ?? "ABC").toUpperCase().replace(/[^ABC]/g, "");
  const set = new Set<"A" | "B" | "C">();
  for (const ch of raw) set.add(ch as "A" | "B" | "C");
  if (set.size === 0) return new Set(["A", "B", "C"]);
  return set;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---------- City-catalog (optional) ----------
export interface CityCatalogRow {
  city: string;
  state?: string;
  aliases?: string[];
}

export type CityCatalog = CityCatalogRow[];

/**
 * Loads a city catalog if CATALOG_CITY_FILE is set.
 * Accepts JSON array or JSONL (one JSON object per line).
 * Returns [] on any error.
 */
export function loadCityCatalog(filePath: string | null): CityCatalog {
  if (!filePath) return [];
  try {
    const abs = path.resolve(filePath);
    const raw = fs.readFileSync(abs, "utf8");
    // Detect JSONL by lines with `{`
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length > 1 && lines.every((l) => l.trim().startsWith("{"))) {
      const out: CityCatalog = [];
      for (const line of lines) {
        try {
          const o = JSON.parse(line);
          if (o && typeof o === "object" && typeof o.city === "string") {
            out.push({
              city: String(o.city),
              state: o.state ? String(o.state) : undefined,
              aliases: Array.isArray(o.aliases)
                ? o.aliases.map((a) => String(a))
                : undefined,
            });
          }
        } catch {
          // skip bad line
        }
      }
      return out;
    }
    // Regular JSON (array)
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr
        .map((o) => ({
          city: String(o?.city ?? ""),
          state: o?.state ? String(o.state) : undefined,
          aliases: Array.isArray(o?.aliases)
            ? o.aliases.map((a: unknown) => String(a))
            : undefined,
        }))
        .filter((r) => r.city);
    }
  } catch {
    // ignore
  }
  return [];
}

// ---------- Public config ----------
export interface AppConfig {
  // Places
  placesApiKey?: string;
  placesLimitDefault: number;

  // Guardrails / tuning
  allowTiers: Set<"A" | "B" | "C">;
  confidenceMin: number; // 0..1
  earlyExitFound: number;

  maxProbesPerFindFree: number;
  maxProbesPerFindPro: number;

  maxResultsFree: number;
  maxResultsPro: number;

  freeClicksPerDay: number; // daily free cap
  freeCooldownMin: number;  // cooldown when cap is hit

  cacheTtlSec: number;

  // Per-host circuit breaker
  hostCircuitFails: number;
  hostCircuitCooldownSec: number;

  enableAutoTune: boolean;

  // Optional city-catalog file (secrets mount)
  cityCatalogFile: string | null;
}

export const CFG: AppConfig = {
  placesApiKey: str(process.env.GOOGLE_PLACES_API_KEY || undefined, undefined),
  placesLimitDefault: toNum(process.env.PLACES_LIMIT_DEFAULT, 25, 1, 50),

  allowTiers: tiersSet(process.env.ALLOW_TIERS), // e.g. "AB", "C", "ABC"
  confidenceMin: clamp(toNum(process.env.CONFIDENCE_MIN, 0.72), 0, 1),
  earlyExitFound: toNum(process.env.EARLY_EXIT_FOUND, 3, 1, 50),

  maxProbesPerFindFree: toNum(process.env.MAX_PROBES_PER_FIND_FREE, 20, 1, 100),
  maxProbesPerFindPro: toNum(process.env.MAX_PROBES_PER_FIND_PRO, 50, 1, 200),

  maxResultsFree: toNum(process.env.MAX_RESULTS_FREE, 3, 1, 20),
  maxResultsPro: toNum(process.env.MAX_RESULTS_PRO, 10, 1, 50),

  freeClicksPerDay: toNum(process.env.FREE_CLICKS_PER_DAY, 2, 0, 1000),
  freeCooldownMin: toNum(process.env.FREE_COOLDOWN_MIN, 30, 0, 1440),

  cacheTtlSec: toNum(process.env.CACHE_TTL_S, 600, 0, 86400),

  hostCircuitFails: toNum(process.env.HOST_CIRCUIT_FAILS, 5, 1, 100),
  hostCircuitCooldownSec: toNum(
    process.env.HOST_CIRCUIT_COOLDOWN_S,
    600,
    0,
    86400
  ),

  enableAutoTune: toBool(process.env.ENABLE_AUTO_TUNE, true),

  cityCatalogFile: str(process.env.CATALOG_CITY_FILE || "", "") || null,
};

// Handy clamps the routers can use
export function capResults(isPro: boolean, want: number): number {
  const max = isPro ? CFG.maxResultsPro : CFG.maxResultsFree;
  return clamp(want || CFG.placesLimitDefault, 1, max);
}