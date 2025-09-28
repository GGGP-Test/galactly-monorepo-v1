// src/routes/leads.ts
//
// Find buyer leads from the catalog with slider-aware scoring,
// add an uncertainty estimate, and (optionally) escalate a few
// high-uncertainty candidates to /api/classify for cheap enrichment.

import { Router, Request, Response } from "express";
import { CFG, capResults } from "../shared/env";

// Intentionally import via require so typings are "any" and we don't
// couple to exact symbol names. Some deployments may not include TRC;
// make it optional so the server never crashes at startup.
const Catalog: any = require("../shared/catalog");
const Prefs: any = require("../shared/prefs");

let TRC: any = {};
try {
  // If dist/shared/trc.js exists, we’ll use it; otherwise we proceed with the built-in heuristic.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  TRC = require("../shared/trc");
} catch (e) {
  console.warn("[leads] optional module ../shared/trc not found; falling back to heuristic scoring");
}

const F: (url: string, init?: any) => Promise<any> = (globalThis as any).fetch;

const r = Router();

type Candidate = {
  host: string;
  name?: string;
  city?: string;
  tier?: "A" | "B" | "C";
  tiers?: Array<"A" | "B" | "C">;
  tags?: string[];
  [k: string]: any;
};

function getCatalogRows(): Candidate[] {
  // Support multiple catalog module shapes.
  if (typeof Catalog.get === "function") return Catalog.get();
  if (typeof Catalog.rows === "function") return Catalog.rows();
  if (Array.isArray(Catalog.rows)) return Catalog.rows as Candidate[];
  if (Array.isArray(Catalog.catalog)) return Catalog.catalog as Candidate[];
  if (typeof Catalog.all === "function") return Catalog.all();
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
  if (a === b) return 0.15;
  if (b.includes(a) || a.includes(b)) return 0.1;
  return 0;
}

// Provide default thresholds if TRC doesn't export them.
const HOT_T = Number(TRC?.HOT_MIN ?? 80);
const WARM_T = Number(TRC?.WARM_MIN ?? 55);

function bandFromScore(score: number): "HOT" | "WARM" | "COOL" {
  if (typeof TRC?.classifyScore === "function") {
    try { return TRC.classifyScore(score); } catch { /* noop */ }
  }
  if (score >= HOT_T) return "HOT";
  if (score >= WARM_T) return "WARM";
  return "COOL";
}

// Uncertainty = closeness to band boundary, scaled 0..1 (1 = most uncertain)
function uncertainty(score: number): number {
  const dHot = Math.abs(score - HOT_T);
  const dWarm = Math.abs(score - WARM_T);
  const d = Math.min(dHot, dWarm);
  // 0 distance => 1.0 uncertainty; >=10 points away => ~0
  const u = Math.max(0, 1 - d / 10);
  return Number.isFinite(u) ? Number(u.toFixed(3)) : 0;
}

function safeScoreRow(row: Candidate, prefs: any, city?: string) {
  if (typeof TRC?.scoreRow === "function") {
    try {
      // Expected to return { score:number, reasons:string[] }
      const out = TRC.scoreRow(row, prefs, city);
      if (out && typeof out.score === "number") return out;
    } catch { /* ignore */ }
  }
  // Fallback heuristic if TRC not present or fails
  let score = 50;
  const reasons: string[] = [];

  // Size/Signal weights (very light)
  const sw = Number(prefs?.sizeWeight ?? 0);
  const iw = Number(prefs?.signalWeight ?? 0);
  if (sw) { score += Math.min(10, sw * 2); reasons.push(`sizeWeight+${sw}`); }
  if (iw) { score += Math.min(10, iw * 2); reasons.push(`signalWeight+${iw}`); }

  // City proximity
  const boost = cityBoost(city, row.city);
  if (boost) { score += boost * 100; reasons.push(`locality+${(boost*100)|0}`); }

  // Tags overlap (very cheap)
  const wantTags: string[] = Array.isArray(prefs?.likeTags) ? prefs.likeTags : [];
  const hasTags: string[] = Array.isArray(row.tags) ? row.tags : [];
  if (wantTags.length && hasTags.length) {
    const set = new Set(hasTags.map((t) => String(t).toLowerCase()));
    const hit = wantTags.map((t: string) => String(t).toLowerCase()).filter((t: string) => set.has(t)).length;
    if (hit) { score += Math.min(15, hit * 5); reasons.push(`tags+${hit}`); }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}

// Cheap enrichment via our own classifier endpoint (rule-based, cached)
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

const r = Router();

r.get("/find-buyers", async (req: Request, res: Response) => {
  try {
    const host = String(req.query.host || "").trim().toLowerCase();
    const city = String(req.query.city || "").trim();
    const minTier = String(req.query.minTier || "").trim().toUpperCase() as "A" | "B" | "C" | "";
    const limitQ = Number(req.query.limit ?? 0);

    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    // Plan: keep simple for now; default to "free"
    const cap = capResults("free", limitQ);

    // Load prefs for this host (effective / clamped)
    const prefs =
      (typeof Prefs?.getEffective === "function" && Prefs.getEffective(host)) ||
      (typeof Prefs?.getEffectivePrefs === "function" && Prefs.getEffectivePrefs(host)) ||
      (typeof Prefs?.get === "function" && Prefs.get(host)) ||
      {};

    const rows: Candidate[] = getCatalogRows();

    // Filter by allowed tiers + optional minTier
    const filtered = rows.filter((c) => {
      const t = getTier(c);
      // Env allow list
      if (!CFG.allowTiers.has(t)) return false;
      // Optional minTier gate (A>B>C). If minTier is "B", drop "C".
      if (minTier === "A" && t !== "A") return false;
      if (minTier === "B" && t === "C") return false;
      return true;
    });

    // Score
    const scored = filtered.map((c) => {
      const { score, reasons } = safeScoreRow(c, prefs, city);
      const band = bandFromScore(score);
      const u = uncertainty(score);
      return { ...c, score, band, uncertainty: u, reasons: Array.isArray(reasons) ? reasons : [] };
    });

    // Sort HOT then WARM, by score desc
    const hot = scored.filter((x) => x.band === "HOT").sort((a, b) => b.score - a.score);
    const warm = scored.filter((x) => x.band === "WARM").sort((a, b) => b.score - a.score);
    let items = [...hot, ...warm];
    const totalBeforeCap = items.length;
    if (cap > 0) items = items.slice(0, cap);

    // Tiny escalation: enrich the top-N most uncertain among the items we will return.
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
        city: city || null,
        minTier: minTier || null,
      },
    });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "find-buyers-failed", detail: msg });
  }
});

export default r;