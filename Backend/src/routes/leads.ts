// src/routes/leads.ts
//
// Artemis B v1 — Buyer discovery (CJS-safe) with per-request tier + band control.
// Query params:
//   - tiers=A,B,C
//   - size=small|medium|large   (alias for tiers=C|B|A)
//   - preferTier=A|B|C
//   - preferSize=small|medium|large
//   - minBand=COOL|WARM|HOT     (default COOL if prefer C/small else WARM)
//
// GET /api/leads/ping
// GET /api/leads/find-buyers?host=acme.com[&city=&tags=&sectors=&minTier=&limit=]
//
// Emits a tiny event to /api/events/ingest so Admin "Recent (50)" shows activity.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Router, type Request, type Response } from "express";
import { CFG, capResults } from "../shared/env";
import * as CatalogMod from "../shared/catalog";
import * as Prefs from "../shared/prefs";
import * as TRC from "../shared/trc";

const Catalog: any = (CatalogMod as any)?.default ?? (CatalogMod as any);
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

type Band = "HOT" | "WARM" | "COOL";

type Scored = Candidate & {
  score: number;
  band: Band;
  uncertainty: number;
  reasons: string[];
  tier: "A" | "B" | "C";
  url: string;
  name: string;
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

function bandFromScore(score: number): Band {
  if (typeof (TRC as any)?.classifyScore === "function") {
    try { return (TRC as any).classifyScore(score) as Band; } catch { /* noop */ }
  }
  if (score >= HOT_T) return "HOT";
  if (score >= WARM_T) return "WARM";
  return "COOL";
}

function uncertainty(score: number): number {
  const d = Math.min(Math.abs(score - HOT_T), Math.abs(score - WARM_T));
  const u = Math.max(0, 1 - d / 10);
  return Number.isFinite(u) ? Number(u.toFixed(3)) : 0;
}

// fire-and-forget event so Admin "Recent (50)" shows activity
async function emit(kind: string, data: any) {
  try {
    const url = `http://127.0.0.1:${CFG.port}/api/events/ingest`;
    await F(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, at: new Date().toISOString(), data }),
    });
  } catch { /* ignore */ }
}

/* -------- request-tier parsing (tiers/size + preferTier/preferSize) -------- */

const SIZE_TO_TIER: Record<string, "A"|"B"|"C"> = {
  large: "A", l: "A",
  medium: "B", m: "B",
  small: "C", s: "C"
};

function parseTiersParam(req: Request): {
  allow: Set<"A"|"B"|"C">;
  prefer?: "A"|"B"|"C";
  preferWasSmall: boolean;
} {
  const envAllow = new Set<"A"|"B"|"C">(Array.from(CFG.allowTiers ?? new Set(["A","B","C"])) as any);

  const tiersQ = String(req.query.tiers || "").trim();
  const sizeQ  = String(req.query.size  || "").trim().toLowerCase();
  let hardAllow: Set<"A"|"B"|"C"> | null = null;

  if (tiersQ) {
    const set = new Set<"A"|"B"|"C">();
    for (const t of tiersQ.split(",").map(s => s.trim().toUpperCase())) {
      if (t === "A" || t === "B" || t === "C") set.add(t);
    }
    if (set.size) hardAllow = set;
  } else if (sizeQ) {
    const mapped = SIZE_TO_TIER[sizeQ];
    if (mapped) hardAllow = new Set([mapped]);
  }

  const allow = hardAllow
    ? new Set<"A"|"B"|"C">([...hardAllow].filter(t => envAllow.has(t)))
    : envAllow;

  const preferT = String(req.query.preferTier || "").trim().toUpperCase();
  const preferS = String(req.query.preferSize || "").trim().toLowerCase();
  let prefer: "A"|"B"|"C" | undefined;
  let preferWasSmall = false;

  if (preferT === "A" || preferT === "B" || preferT === "C") {
    prefer = preferT as any;
    preferWasSmall = prefer === "C";
  } else if (preferS && SIZE_TO_TIER[preferS]) {
    prefer = SIZE_TO_TIER[preferS];
    preferWasSmall = prefer === "C";
  }

  return { allow, prefer, preferWasSmall };
}

/* ---------------------------- scoring (fallback) --------------------------- */

function safeScoreRow(row: Candidate, prefs: any, city?: string) {
  if (typeof (TRC as any)?.scoreRow === "function") {
    try {
      const out = (TRC as any).scoreRow(row, prefs, city);
      if (out && typeof out.score === "number") return out;
    } catch {}
  }

  let score = 50;
  const reasons: string[] = [];

  const loc = cityBoost(city || (prefs?.city as string), row.city);
  if (loc) { score += loc * 100; reasons.push(`local+${(loc * 100) | 0}`); }

  const want = new Set<string>(uniqLower(prefs?.categoriesAllow || []));
  if (want.size) {
    const have = new Set<string>([
      ...uniqLower(row.tags || []),
      ...uniqLower(row.segments || []),
    ]);
    let hits = 0; want.forEach((t) => { if (have.has(t)) hits++; });
    if (hits) { score += Math.min(15, hits * 5); reasons.push(`tags+${hits}`); }
  }

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

/* --------------------------------- routes --------------------------------- */

r.get("/ping", (_req: Request, res: Response) => res.json({ pong: true, at: new Date().toISOString() }));

r.get("/find-buyers", async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const host = String(req.query.host || req.query.domain || "").trim().toLowerCase();
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    const cityQ = String(req.query.city || "").trim();
    const minTier = String(req.query.minTier || "").trim().toUpperCase() as "A" | "B" | "C" | "";
    const limitQ = Number(req.query.limit ?? 0);

    // Per-request tier controls
    const { allow: allowTiers, prefer: preferTier, preferWasSmall } = parseTiersParam(req);

    // minBand (default COOL if preferring small/C, else WARM)
    const rawMinBand = String(req.query.minBand || req.query.bandMin || "").trim().toUpperCase();
    const minBand: Band =
      rawMinBand === "HOT" ? "HOT" :
      rawMinBand === "WARM" ? "WARM" :
      rawMinBand === "COOL" ? "COOL" :
      (preferWasSmall ? "COOL" : "WARM");

    const bandOrder: Record<Band, number> = { HOT: 3, WARM: 2, COOL: 1 };

    // Overlays
    const tagsQ    = uniqLower(String(req.query.tags || "").split(","));
    const sectorsQ = uniqLower(String(req.query.sectors || "").split(","));
    const overlayTags = [...new Set<string>([...tagsQ, ...sectorsQ])];

    // Result cap (by plan)
    const cap = capResults("free", limitQ);

    // Effective prefs
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

    const rows: Candidate[] = getCatalogRows();

    // Filter by allowed tiers + optional minTier
    const filtered = rows.filter((c) => {
      const t = getTier(c);
      if (!allowTiers.has(t)) return false;
      if (minTier === "A" && t !== "A") return false;
      if (minTier === "B" && t === "C") return false;
      return true;
    });

    // Score (+ optional preferTier boost)
    const scored: Scored[] = filtered.map<Scored>((c) => {
      let { score, reasons } = safeScoreRow(c, mergedPrefs, mergedPrefs.city);
      const t = getTier(c);
      if (preferTier && t === preferTier) { score += 8; reasons = [...reasons, `prefer:${t}`]; }
      const band: Band = bandFromScore(score);
      const u = uncertainty(score);
      const name = (c.name || c.company || prettyHostName(c.host)) as string;
      const url = (c.url || `https://${c.host}`) as string;
      const tier = t;
      const trimmedReasons = Array.isArray(reasons) ? reasons.slice(0, 12) : [];
      return { ...c, host: c.host, name, city: c.city, tier, url, score, band, uncertainty: u, reasons: trimmedReasons };
    });

    // Keep at/above minBand
    const kept: Scored[] = scored.filter((x) => bandOrder[x.band] >= bandOrder[minBand]);

    // Sort HOT→WARM→COOL by score
    const hot  = kept.filter((x) => x.band === "HOT").sort((a, b) => b.score - a.score);
    const warm = kept.filter((x) => x.band === "WARM").sort((a, b) => b.score - a.score);
    const cool = kept.filter((x) => x.band === "COOL").sort((a, b) => b.score - a.score);
    let items: Scored[] = [...hot, ...warm, ...cool];

    const totalBeforeCap = items.length;
    if (cap > 0) items = items.slice(0, cap);

    // Enrich a couple uncertain
    const MAX_ESCALATE = 2;
    const targets = [...items]
      .filter((x) => x.uncertainty >= 0.6)
      .sort((a, b) => b.uncertainty - a.uncertainty)
      .slice(0, MAX_ESCALATE);

    for (const t of targets) {
      try {
        const url = `http://127.0.0.1:${CFG.port}/api/classify?host=${encodeURIComponent(t.host)}`;
        const res2 = await F(url, { redirect: "follow" });
        if (res2?.ok) {
          const data = await res2.json();
          if (data?.evidence?.length) {
            t.reasons = [...t.reasons, ...data.evidence.map((e: string)=>`classify:${e}`)].slice(0, 12);
          }
          if (data?.role) t.reasons.push(`role:${data.role}@${(data.confidence ?? 0).toFixed(2)}`);
        }
      } catch {}
    }

    const summary = {
      requested: limitQ || null,
      returned: items.length,
      hot: items.filter((x) => x.band === "HOT").length,
      warm: items.filter((x) => x.band === "WARM").length,
      cool: items.filter((x) => x.band === "COOL").length,
      totalBeforeCap,
      capApplied: cap,
      city: mergedPrefs.city || null,
      minTier: minTier || null,
      tiersApplied: Array.from(allowTiers),
      preferTier: preferTier || null,
      minBandApplied: minBand,
      overlays: { tags: overlayTags.slice(0, 12) },
      ms: Date.now() - t0,
    };

    // Emit event for Admin "Recent (50)"
    emit("find_buyers", { host, ...summary }).catch(() => {});

    return res.json({ ok: true, items, summary });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "find-buyers-failed", detail: msg });
  }
});

export default r;