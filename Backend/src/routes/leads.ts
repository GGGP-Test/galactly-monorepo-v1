// src/routes/leads.ts
//
// Artemis B v1 — Buyer discovery (CJS-safe)
// - Scores catalog rows using TRC (if present) with prefs + query overlays
// - Adds band + uncertainty + compact reasons
// - Soft-enriches a couple of uncertain items via /api/classify
//
// GET /api/leads/ping
// GET /api/leads/find-buyers?host=acme.com[&city=&tags=a,b&sectors=x,y&minTier=A|B|C&limit=12]

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Router, type Request, type Response } from "express";
import { CFG, capResults } from "../shared/env";

// Static imports only (no import.meta / dynamic import)
import * as CatalogMod from "../shared/catalog";
import * as Prefs from "../shared/prefs";
import * as TRC from "../shared/trc";

// Normalize default vs named export from catalog.ts
const Catalog: any = (CatalogMod as any)?.default ?? (CatalogMod as any);

// Node 18+ global fetch (typed)
const F: (url: string, init?: any) => Promise<any> = (globalThis as any).fetch;

const r = Router();

/* --------------------------------- types ---------------------------------- */

type Candidate = {
  host: string;
  name?: string;
  company?: string;
  city?: string;
  url?: string;
  tier?: "A" | "B" | "C";
  tiers?: Array<"A" | "B" | "C">;
  tags?: string[];
  segments?: string[];
  [k: string]: any;
};

/* -------------------------------- helpers --------------------------------- */

function uniqLower(arr: unknown): string[] {
  const set = new Set<string>();
  if (Array.isArray(arr)) for (const v of arr) {
    const s = String(v ?? "").trim().toLowerCase();
    if (s) set.add(s);
  }
  return [...set];
}

function getCatalogRows(): Candidate[] {
  if (typeof Catalog?.get === "function") return Catalog.get();
  if (typeof Catalog?.rows === "function") return Catalog.rows();
  if (Array.isArray(Catalog?.rows)) return Catalog.rows as Candidate[];
  if (Array.isArray(Catalog?.catalog)) return Catalog.catalog as Candidate[];
  if (typeof Catalog?.all === "function") return Catalog.all();
  return [];
}

function getTier(c: Candidate): "A" | "B" | "C" {
  if (c.tier === "A" || c.tier === "B" || c.tier === "C") return c.tier;
  const t = (Array.isArray(c.tiers) ? c.tiers[0] : undefined) as any;
  return t === "A" || t === "B" ? t : "C";
}

function cityBoost(city?: string, candidateCity?: string): number {
  if (!city || !candidateCity) return 0;
  const a = city.trim().toLowerCase();
  const b = candidateCity.trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 0.15;
  if (b.includes(a) || a.includes(b)) return 0.1;
  return 0;
}

function prettyHostName(h: string): string {
  const stem = String(h || "").replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ");
  return stem.replace(/\b\w/g, (m) => m.toUpperCase());
}

const HOT_T  = Number((TRC as any)?.HOT_MIN  ?? 80);
const WARM_T = Number((TRC as any)?.WARM_MIN ?? 55);

function bandFromScore(score: number): "HOT" | "WARM" | "COOL" {
  if (typeof (TRC as any)?.classifyScore === "function") {
    try { return (TRC as any).classifyScore(score); } catch { /* noop */ }
  }
  if (score >= HOT_T) return "HOT";
  if (score >= WARM_T) return "WARM";
  return "COOL";
}

// Uncertainty ~ distance to band boundary (0..1, higher = shakier)
function uncertainty(score: number): number {
  const d = Math.min(Math.abs(score - HOT_T), Math.abs(score - WARM_T));
  const u = Math.max(0, 1 - d / 10);
  return Number.isFinite(u) ? Number(u.toFixed(3)) : 0;
}

/* ---------------------------- scoring (fallback) --------------------------- */

function safeScoreRow(row: Candidate, prefs: any, city?: string) {
  // Prefer TRC.scoreRow if present
  if (typeof (TRC as any)?.scoreRow === "function") {
    try {
      const out = (TRC as any).scoreRow(row, prefs, city);
      if (out && typeof out.score === "number") return out;
    } catch { /* ignore and fallback */ }
  }

  // Minimal, deterministic heuristic aligned with prefs.categoriesAllow
  let score = 50;
  const reasons: string[] = [];

  // Locality
  const loc = cityBoost(city || (prefs?.city as string), row.city);
  if (loc) { score += loc * 100; reasons.push(`local+${(loc * 100) | 0}`); }

  // Tag/category overlap (row.tags/segments vs prefs.categoriesAllow)
  const want = new Set<string>(uniqLower(prefs?.categoriesAllow || []));
  if (want.size) {
    const have = new Set<string>([
      ...uniqLower(row.tags || []),
      ...uniqLower(row.segments || []),
    ]);
    let hits = 0; want.forEach((t) => { if (have.has(t)) hits++; });
    if (hits) { score += Math.min(15, hits * 5); reasons.push(`tags+${hits}`); }
  }

  // Gentle size/signal nudges if objects exist
  const sw = prefs?.sizeWeight || {};
  if (typeof sw === "object") {
    const sz = String(row?.size || "").toLowerCase();
    const w =
      sz === "micro" ? Number(sw.micro ?? 0) :
      sz === "small" ? Number(sw.small ?? 0) :
      sz === "mid"   ? Number(sw.mid   ?? 0) :
      sz === "large" ? Number(sw.large ?? 0) : 0;
    if (w) { score += Math.max(-12, Math.min(12, w * 4)); reasons.push(`size:${sz || "?"}`); }
  }
  const sig = prefs?.signalWeight || {};
  if (sig && (sig.ecommerce || sig.retail || sig.wholesale)) {
    score += Math.min(6, (Number(sig.ecommerce||0) + Number(sig.retail||0) + Number(sig.wholesale||0)) * 2);
    reasons.push("signals");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}

/* ------------------------------ enrichment -------------------------------- */

async function classifyHost(host: string): Promise<{ role?: string; confidence?: number; evidence?: string[] } | null> {
  try {
    const url = `http://127.0.0.1:${CFG.port}/api/classify?host=${encodeURIComponent(host)}`;
    const res = await F(url, { redirect: "follow" });
    if (!res?.ok) return null;
    const data = await res.json();
    if (data?.ok === false) return null;
    return { role: data?.role, confidence: data?.confidence, evidence: data?.evidence || [] };
  } catch {
    return null;
  }
}

/* --------------------------------- routes --------------------------------- */

r.get("/ping", (_req: Request, res: Response) => res.json({ pong: true, at: new Date().toISOString() }));

r.get("/find-buyers", async (req: Request, res: Response) => {
  try {
    const host = String(req.query.host || "").trim().toLowerCase();
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    const cityQ = String(req.query.city || "").trim();
    const minTier = String(req.query.minTier || "").trim().toUpperCase() as "A" | "B" | "C" | "";
    const limitQ = Number(req.query.limit ?? 0);

    // Overlay tags from query (comma-separated)
    const tagsQ    = uniqLower(String(req.query.tags || "").split(","));
    const sectorsQ = uniqLower(String(req.query.sectors || "").split(","));
    const overlayTags = [...new Set<string>([...tagsQ, ...sectorsQ])];

    // Cap results by plan
    const cap = capResults("free", limitQ);

    // Load effective prefs and apply overlays
    const basePrefs =
      (typeof (Prefs as any).getEffective === "function" && (Prefs as any).getEffective(host)) ||
      (typeof (Prefs as any).getEffectivePrefs === "function" && (Prefs as any).getEffectivePrefs(host)) ||
      (typeof (Prefs as any).get === "function" && (Prefs as any).get(host)) ||
      {};

    const mergedPrefs = {
      ...basePrefs,
      city: (cityQ || basePrefs.city || "").trim(),
      categoriesAllow: [...new Set<string>([...(basePrefs.categoriesAllow || []), ...overlayTags])],
    };

    // Read catalog
    const rows: Candidate[] = getCatalogRows();

    // Filter by allowed tiers + optional minTier
    const filtered = rows.filter((c) => {
      const t = getTier(c);
      if (!CFG.allowTiers.has(t)) return false;
      if (minTier === "A" && t !== "A") return false;
      if (minTier === "B" && t === "C") return false;
      return true;
    });

    // Score
    const scored = filtered.map((c) => {
      const { score, reasons } = safeScoreRow(c, mergedPrefs, mergedPrefs.city);
      const band = bandFromScore(score);
      const u = uncertainty(score);
      const name = c.name || c.company || prettyHostName(c.host);
      const url = c.url || `https://${c.host}`;
      const tier = getTier(c);
      const trimmedReasons = Array.isArray(reasons) ? reasons.slice(0, 12) : [];
      return { ...c, host: c.host, name, city: c.city, tier, url, score, band, uncertainty: u, reasons: trimmedReasons };
    });

    // Sort HOT then WARM, by score desc
    const hot = scored.filter((x) => x.band === "HOT").sort((a, b) => b.score - a.score);
    const warm = scored.filter((x) => x.band === "WARM").sort((a, b) => b.score - a.score);
    let items = [...hot, ...warm];
    const totalBeforeCap = items.length;
    if (cap > 0) items = items.slice(0, cap);

    // Enrich a couple of the most uncertain within the returned slice
    const MAX_ESCALATE = 2;
    const targets = [...items]
      .filter((x) => x.uncertainty >= 0.6)
      .sort((a, b) => b.uncertainty - a.uncertainty)
      .slice(0, MAX_ESCALATE);

    for (const t of targets) {
      const info = await classifyHost(t.host);
      if (info?.evidence?.length) {
        t.reasons = [...t.reasons, ...info.evidence.map((e) => `classify:${e}`)].slice(0, 12);
      }
      if (info?.role) {
        t.reasons.push(`role:${info.role}@${(info.confidence ?? 0).toFixed(2)}`);
      }
    }

    return res.json({
      ok: true,
      items,
      summary: {
        requested: limitQ || null,
        returned: items.length,
        hot: items.filter((x) => x.band === "HOT").length,
        warm: items.filter((x) => x.band === "WARM").length,
        totalBeforeCap,
        capApplied: cap,
        city: mergedPrefs.city || null,
        minTier: minTier || null,
        overlays: {
          tags: overlayTags.slice(0, 12),
        },
      },
    });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "find-buyers-failed", detail: msg });
  }
});

export default r;