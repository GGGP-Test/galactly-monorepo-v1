// src/shared/ads-store.ts
//
// Canonical in-memory store for "ad intelligence".
// Routes (e.g. /api/ads/bulk) write here, scorers read from here.
// No external deps. Safe across hot-reloads (per-pod memory).
//
// Signals exposed:
//  - getStats(host): raw aggregates (lastSeen, platforms, density, recencyDays, etc.)
//  - getSignal(host): 0..1 activity score with recency & density shaping
//  - upsertBulk([{host, rows}])
//  - clear()

/* eslint-disable @typescript-eslint/no-explicit-any */

import { CFG } from "./env";

export type AdRow = {
  platform?: string;          // "meta" | "google" | "tiktok" | ...
  landing?: string;           // landing page URL (optional)
  seenAtISO?: string;         // ISO timestamp when observed
  creativeUrl?: string;       // optional asset link
  text?: string;              // optional ad text
};

export type HostAds = {
  host: string;
  rows: AdRow[];
  lastSeen?: string;          // ISO
};

type StoreRec = {
  rows: AdRow[];
  lastSeenMs: number;
  lastSeenIso: string;
};

const STORE = new Map<string, StoreRec>(); // key = normalized host

function normHost(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function toMs(iso?: string): number {
  const t = Date.parse(String(iso || ""));
  return Number.isFinite(t) ? t : 0;
}

function asIso(ms: number): string {
  try { return new Date(ms).toISOString(); } catch { return ""; }
}

/** Insert/merge a single host’s rows. */
export function upsertHost(hostLike: string, rows: AdRow[]): void {
  const host = normHost(hostLike);
  if (!host || !Array.isArray(rows) || rows.length === 0) return;

  const clean: AdRow[] = [];
  let last = 0;

  for (const r of rows) {
    const platform = String(r.platform || "").toLowerCase().trim();
    const landing = String(r.landing || "").trim();
    const seenMs = toMs(r.seenAtISO);
    if (!platform && !landing && !seenMs) continue;
    last = Math.max(last, seenMs || 0);
    clean.push({
      platform: platform || undefined,
      landing: landing || undefined,
      seenAtISO: seenMs ? asIso(seenMs) : undefined,
      creativeUrl: r.creativeUrl ? String(r.creativeUrl) : undefined,
      text: r.text ? String(r.text) : undefined,
    });
  }

  if (!clean.length) return;

  const prev = STORE.get(host);
  if (!prev) {
    STORE.set(host, {
      rows: clean,
      lastSeenMs: last || 0,
      lastSeenIso: (last ? asIso(last) : "") || "",
    });
    return;
  }

  // Merge (dedupe by platform+landing+seenAtISO)
  const keyOf = (x: AdRow) => `${x.platform || ""}|${x.landing || ""}|${x.seenAtISO || ""}`;
  const seen = new Set<string>(prev.rows.map(keyOf));
  for (const c of clean) {
    const k = keyOf(c);
    if (!seen.has(k)) {
      prev.rows.push(c);
      seen.add(k);
    }
  }
  prev.lastSeenMs = Math.max(prev.lastSeenMs, last || 0);
  prev.lastSeenIso = prev.lastSeenMs ? asIso(prev.lastSeenMs) : prev.lastSeenIso;
}

/** Bulk upsert: { items:[{host, rows:[...]}, ...] } */
export function upsertBulk(payload: { items?: Array<{ host: string; rows: AdRow[] }> } | any): number {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  let n = 0;
  for (const it of items) {
    if (!it || !it.host || !Array.isArray(it.rows)) continue;
    upsertHost(it.host, it.rows);
    n += it.rows.length;
  }
  return n;
}

/** Clear the in-memory store (ops/tests). */
export function clear() {
  STORE.clear();
}

/** Raw aggregates used by debug/admin and scorers. */
export function getStats(hostLike: string): {
  host: string;
  lastSeen?: string;
  recencyDays: number;
  platforms: string[];
  landings: string[];
  densityLast30: number;
  total: number;
} {
  const host = normHost(hostLike);
  const rec = STORE.get(host);
  if (!rec) {
    return {
      host,
      lastSeen: undefined,
      recencyDays: Number.POSITIVE_INFINITY,
      platforms: [],
      landings: [],
      densityLast30: 0,
      total: 0,
    };
  }
  const now = Date.now();
  const lastMs = rec.lastSeenMs || 0;
  const recencyDays = lastMs ? Math.max(0, (now - lastMs) / (24 * 3600 * 1000)) : Number.POSITIVE_INFINITY;

  const cutoff = now - 30 * 24 * 3600 * 1000;
  const recent = rec.rows.filter(r => toMs(r.seenAtISO) >= cutoff);

  const platforms = Array.from(new Set(recent.map(r => (r.platform || "").toLowerCase()).filter(Boolean)));
  const landings = Array.from(new Set(recent.map(r => String(r.landing || "")).filter(Boolean)));

  return {
    host,
    lastSeen: rec.lastSeenIso || undefined,
    recencyDays: Number.isFinite(recencyDays) ? Number(recencyDays.toFixed(2)) : Number.POSITIVE_INFINITY,
    platforms,
    landings,
    densityLast30: recent.length,
    total: rec.rows.length,
  };
}

/**
 * 0..1 ads activity signal with simple shaping:
 * - recency: exponential half-life (AD_RECENCY_HALF_LIFE_DAYS)
 * - density: saturates as recent count approaches AD_DENSITY_AT_MAX
 */
export function getSignal(hostLike: string): number {
  const s = getStats(hostLike);
  if (!Number.isFinite(s.recencyDays)) return 0;

  const HL = Math.max(1, Number(process.env.AD_RECENCY_HALF_LIFE_DAYS || CFG ?  Number(CFG["AD_RECENCY_HALF_LIFE_DAYS" as keyof typeof CFG] || 14) : 14));
  const AT = Math.max(1, Number(process.env.AD_DENSITY_AT_MAX || CFG ? Number(CFG["AD_DENSITY_AT_MAX" as keyof typeof CFG] || 8) : 8));

  // recency decay: 1.0 at t=0, halves every HL days
  const recencyFactor = Math.pow(0.5, s.recencyDays / HL);

  // density saturates towards 1 as count approaches AT
  const densityFactor = Math.min(1, s.densityLast30 / AT);

  const out = Math.max(0, Math.min(1, 0.6 * recencyFactor + 0.4 * densityFactor));
  return Number(out.toFixed(3));
}

// --- debug helpers for admin/debug pages (optional) ---
export function __debugListHosts(limit = 50): Array<{ host: string; lastSeen?: string; total: number }> {
  const items: Array<{ host: string; lastSeen?: string; total: number }> = [];
  for (const [host, rec] of STORE.entries()) {
    items.push({ host, lastSeen: rec.lastSeenIso || undefined, total: rec.rows.length });
    if (items.length >= limit) break;
  }
  return items;
}