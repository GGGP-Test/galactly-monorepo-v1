// src/shared/ads.ts
//
// Lightweight ads-intel aggregator. No external deps.
// - Normalizes raw "ad library" rows (any platform) into one shape
// - Maintains in-memory signals by buyer host
// - Can bootstrap from ENV (ADS_SIGNALS_FILE or ADS_SIGNALS_JSON)
// - Exposes derived scores you can feed into scorer later
//
// Wiring: later, we can add a small route to POST batches into this store.
// For now, other modules can import { getAdSignalsForHost, adActivityScore }.

import fs from "fs";
import path from "path";

// ----------------------------- Types -----------------------------------------

export type AdPlatform = "facebook" | "instagram" | "google" | "youtube" | "tiktok" | "other";

export interface RawAdRow {
  platform?: string;             // free-form; normalized via toPlatform()
  advertiser?: string;           // e.g., "Magnolia Bakery"
  landingUrl?: string;           // any URL; host will be extracted
  creativeText?: string;         // text we can mine for tags later
  firstSeen?: string;            // ISO date string
  lastSeen?: string;             // ISO date string
  region?: string;               // optional
}

export interface NormalizedAd extends RawAdRow {
  platform: AdPlatform;
  host: string;                  // landing host (lower-cased)
  lastSeenISO?: string;
  firstSeenISO?: string;
}

export interface AdSignals {
  host: string;

  platforms: string[];           // unique list
  activeAds: number;             // unique active ads in current window
  creativeCount30d: number;      // rough velocity proxy
  lastAdSeenISO?: string;        // freshest ad ISO
  lastAdSeenDays?: number;       // days since freshest ad

  landingHosts: string[];        // if creatives jump across subdomains
  keywords: string[];            // naive token set (future: better NLP)
}

// --------------------------- In-memory store ---------------------------------

const store = new Map<string, AdSignals>(); // key = buyer host

// --------------------------- Helpers -----------------------------------------

function toPlatform(s?: string): AdPlatform {
  const v = (s || "").toLowerCase();
  if (v.includes("facebook") || v === "fb") return "facebook";
  if (v.includes("instagram") || v === "ig") return "instagram";
  if (v.includes("google")) return "google";
  if (v.includes("youtube")) return "youtube";
  if (v.includes("tiktok")) return "tiktok";
  return "other";
}

function hostFromUrl(u?: string): string {
  try {
    if (!u) return "";
    const h = new URL(u).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  const ms = Date.now() - t;
  return ms < 0 ? 0 : Math.floor(ms / 86400000);
}

function tokenize(text?: string): string[] {
  const s = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_/]/g, " ");
  const words = s.split(/\s+/).filter(Boolean);
  // keep only useful-ish tokens
  const stop = new Set([
    "the","and","for","with","from","that","this","you","your","our","shop","buy",
    "now","today","free","off","sale","new","best","more"
  ]);
  const kept = words.filter(w => w.length >= 3 && !stop.has(w));
  return Array.from(new Set(kept)).slice(0, 64);
}

// ------------------------- Normalization / Upsert ----------------------------

export function normalizeRows(rows: RawAdRow[]): NormalizedAd[] {
  const out: NormalizedAd[] = [];
  for (const r of rows) {
    const host = hostFromUrl(r.landingUrl) || "";
    out.push({
      ...r,
      platform: toPlatform(r.platform),
      host,
      lastSeenISO: r.lastSeen && new Date(r.lastSeen).toISOString(),
      firstSeenISO: r.firstSeen && new Date(r.firstSeen).toISOString(),
    });
  }
  return out;
}

export function upsertAdRows(buyerHost: string, rows: RawAdRow[]): AdSignals {
  const host = (buyerHost || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host) throw new Error("buyerHost required");

  const norm = normalizeRows(rows).filter(r => r.host);
  const platforms = Array.from(new Set(norm.map(r => r.platform)));

  // recent window: 30d creative count
  const now = Date.now();
  const in30d = norm.filter(r => r.lastSeenISO && (now - Date.parse(r.lastSeenISO)) <= 30 * 86400000);

  const last = norm
    .map(r => r.lastSeenISO ? Date.parse(r.lastSeenISO) : -1)
    .reduce((a, b) => Math.max(a, b), -1);

  const lastISO = last > 0 ? new Date(last).toISOString() : undefined;

  const landingHosts = Array.from(new Set(norm.map(r => r.host))).slice(0, 10);

  const kws = Array.from(
    new Set(norm.flatMap(r => tokenize(r.creativeText)))
  ).slice(0, 64);

  const sig: AdSignals = {
    host,
    platforms: platforms.map(String),
    activeAds: norm.length,
    creativeCount30d: in30d.length,
    lastAdSeenISO: lastISO,
    lastAdSeenDays: daysSince(lastISO),
    landingHosts,
    keywords: kws,
  };

  // merge if existing
  const prev = store.get(host);
  if (!prev) {
    store.set(host, sig);
  } else {
    // simple union/replace
    const merged: AdSignals = {
      host,
      platforms: Array.from(new Set([...prev.platforms, ...sig.platforms])),
      activeAds: Math.max(prev.activeAds, sig.activeAds),
      creativeCount30d: Math.max(prev.creativeCount30d, sig.creativeCount30d),
      lastAdSeenISO: [prev.lastAdSeenISO, sig.lastAdSeenISO].filter(Boolean).sort() .slice(-1)[0],
      lastAdSeenDays: Math.min(
        prev.lastAdSeenDays ?? Infinity,
        sig.lastAdSeenDays ?? Infinity
      ),
      landingHosts: Array.from(new Set([...prev.landingHosts, ...sig.landingHosts])).slice(0, 20),
      keywords: Array.from(new Set([...prev.keywords, ...sig.keywords])).slice(0, 128),
    };
    store.set(host, merged);
  }

  return store.get(host)!;
}

export function getAdSignalsForHost(buyerHost: string): AdSignals | undefined {
  const host = (buyerHost || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return store.get(host);
}

// ------------------------- Scores for the scorer -----------------------------

/**
 * Turn AdSignals into a 0..1 activity score.
 * Uses exponential decay on recency and a logistic squashing on creative velocity.
 */
export function adActivityScore(sig?: AdSignals): number {
  if (!sig) return 0;
  const days = sig.lastAdSeenDays ?? 999;
  const halflife = Math.max(1, Number(process.env.ADS_LAST_SEEN_HALFLIFE_DAYS) || 21);
  const recency = Math.pow(0.5, days / halflife); // 1.0 if today, ~0.5 at halflife

  // velocity: creatives in 30d, squashed
  const v = sig.creativeCount30d;
  const velocity = 1 / (1 + Math.exp(-(v - 5) / 3)); // ~0.5 at 5, >0.8 at ~8–10

  // diversity bonus: more platforms → slightly higher
  const diversity = Math.min(1, (sig.platforms.length - 1) / 3); // 0..1 across ~4 platforms

  const raw = 0.6 * recency + 0.3 * velocity + 0.1 * diversity;
  return Math.max(0, Math.min(1, raw));
}

// ------------------------- Boot from ENV (optional) --------------------------

function readMaybe(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Call once on startup (safe to call multiple times).
 * Loads initial signals from ADS_SIGNALS_FILE or ADS_SIGNALS_JSON.
 */
export function bootstrapAdsFromEnv(): number {
  let rows: any[] = [];
  const file = process.env.ADS_SIGNALS_FILE;
  const inline = process.env.ADS_SIGNALS_JSON;

  if (file) {
    const abs = path.resolve(file);
    const txt = readMaybe(abs);
    if (txt) {
      try { rows = JSON.parse(txt); } catch {}
    }
  }
  if (!rows.length && inline) {
    try { rows = JSON.parse(inline); } catch {}
  }

  if (!Array.isArray(rows) || rows.length === 0) return 0;

  // rows can be for multiple hosts; group by landing URL host
  const grouped = new Map<string, RawAdRow[]>();
  for (const r of rows) {
    const h = hostFromUrl(r.landingUrl || "") || String(r.host || "");
    if (!h) continue;
    const arr = grouped.get(h) || [];
    arr.push(r);
    grouped.set(h, arr);
  }

  let n = 0;
  for (const [host, arr] of grouped.entries()) {
    upsertAdRows(host, arr);
    n += arr.length;
  }
  return n;
}