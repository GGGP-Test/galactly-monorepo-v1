// src/routes/leads.ts
//
// Web-first buyer discovery (uses shared/sources.ts) with per-request tier + band control.
// Query params:
//   - host=acme.com                 (required)
//   - city=San Diego                (optional locality hint)
//   - limit=12
//   - tiers=A,B,C                   hard allow-list (intersected with env ALLOW_TIERS)
//   - size=small|medium|large       alias for tiers=C|B|A
//   - preferTier=A|B|C              small boost toward a tier
//   - preferSize=small|medium|large alias for preferTier
//   - minBand=COOL|WARM|HOT         include results at/above this band
//   - band=HOT_ONLY|WARM_ONLY|COOL_ONLY       exact single band
//   - bands=HOT,WARM (comma list)             exact multi-band
//
// Emits a tiny event to /api/events/ingest so Admin "Recent (50)" shows activity.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Router, type Request, type Response } from "express";
import { CFG, capResults } from "../shared/env";
import * as Prefs from "../shared/prefs";
import * as TRC from "../shared/trc";
import { findBuyersFromWeb, type Candidate as WebCand } from "../shared/sources";

const r = Router();
const F: (url: string, init?: any) => Promise<any> = (globalThis as any).fetch;

/* --------------------------------- types ---------------------------------- */

type Tier = "A" | "B" | "C";
type Band = "HOT" | "WARM" | "COOL";

/* -------------------------------- helpers --------------------------------- */

function uniqLower(arr: unknown): string[] {
  const set = new Set<string>();
  if (Array.isArray(arr)) for (const v of arr) {
    const s = String(v ?? "").trim().toLowerCase();
    if (s) set.add(s);
  }
  return [...set];
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

function getTier(c: { tier?: Tier; tiers?: Tier[] }): Tier {
  if (c.tier === "A" || c.tier === "B" || c.tier === "C") return c.tier;
  const t = (Array.isArray(c.tiers) ? c.tiers[0] : undefined) as any;
  return t === "A" || t === "B" ? t : "C";
}

const HOT_T  = Number((TRC as any)?.HOT_MIN  ?? 80);
const WARM_T = Number((TRC as any)?.WARM_MIN ?? 55);

function bandFromScore(score: number): Band {
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

const SIZE_TO_TIER: Record<string, Tier> = {
  large: "A", l: "A",
  medium: "B", m: "B",
  small: "C", s: "C"
};

function parseTiersParam(req: Request): {
  allow: Set<Tier>;
  prefer?: Tier;
  preferWasSmall: boolean;
} {
  const envAllow = new Set<Tier>(Array.from(CFG.allowTiers ?? new Set(["A","B","C"])) as any);

  const tiersQ = String(req.query.tiers || "").trim();
  const sizeQ  = String(req.query.size  || "").trim().toLowerCase();
  let hardAllow: Set<Tier> | null = null;

  if (tiersQ) {
    const set = new Set<Tier>();
    for (const t of tiersQ.split(",").map(s => s.trim().toUpperCase())) {
      if (t === "A" || t === "B" || t === "C") set.add(t as Tier);
    }
    if (set.size) hardAllow = set;
  } else if (sizeQ) {
    const mapped = SIZE_TO_TIER[sizeQ];
    if (mapped) hardAllow = new Set([mapped]);
  }

  const allow = hardAllow
    ? new Set<Tier>([...hardAllow].filter(t => envAllow.has(t)))
    : envAllow;

  // prefer: preferTier= or preferSize=
  const preferT = String(req.query.preferTier || "").trim().toUpperCase();
  const preferS = String(req.query.preferSize || "").trim().toLowerCase();
  let prefer: Tier | undefined;
  let preferWasSmall = false;
  if (preferT === "A" || preferT === "B" || preferT === "C") {
    prefer = preferT as Tier;
    preferWasSmall = prefer === "C";
  } else if (preferS && SIZE_TO_TIER[preferS]) {
    prefer = SIZE_TO_TIER[preferS];
    preferWasSmall = prefer === "C";
  }

  return { allow, prefer, preferWasSmall };
}

/* ----------------------- band selection parsing ---------------------- */

function bandSelector(req: Request): { mode: "min" | "exact" | "multi"; min?: Band; set?: Set<Band> } {
  const band = String(req.query.band || "").trim().toUpperCase();
  const bands = String(req.query.bands || "").trim().toUpperCase();
  const mb = String(req.query.minBand || req.query.bandMin || "").trim().toUpperCase();

  if (band.endsWith("_ONLY")) {
    const b = band.replace("_ONLY","") as Band;
    if (b === "HOT" || b === "WARM" || b === "COOL") return { mode:"exact", set:new Set<Band>([b]) };
  }
  if (bands) {
    const s = new Set<Band>();
    for (const x of bands.split(",").map(v => v.trim())) {
      if (x === "HOT" || x === "WARM" || x === "COOL") s.add(x as Band);
    }
    if (s.size) return { mode:"multi", set:s };
  }
  if (mb === "HOT" || mb === "WARM" || mb === "COOL") return { mode:"min", min: mb as Band };
  return { mode:"min", min:"WARM" }; // sensible default
}

/* ---------------------------- scoring (fallback) --------------------------- */

function safeScoreRow(row: WebCand, prefs: any, city?: string) {
  if (typeof (TRC as any)?.scoreRow === "function") {
    try {
      const out = (TRC as any).scoreRow(row, prefs, city);
      if (out && typeof out.score === "number") return out;
    } catch {}
  }

  let score = 50;
  const reasons: string[] = [];

  // Locality
  const loc = cityBoost(city || (prefs?.city as string), (row as any).city);
  if (loc) { score += loc * 100; reasons.push(`local+${(loc * 100) | 0}`); }

  // Contactability: website present
  if ((row as any).url) { score += 12; reasons.push("has_site"); }

  // Tag/category overlap (row.tags vs prefs.categoriesAllow)
  const want = new Set<string>(uniqLower(prefs?.categoriesAllow || []));
  if (want.size) {
    const have = new Set<string>(uniqLower((row as any).tags || []));
    let hits = 0; want.forEach((t) => { if (have.has(t)) hits++; });
    if (hits) { score += Math.min(15, hits * 5); reasons.push(`tags+${hits}`); }
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

    const cityQ = String(req.query.city || "").trim() || undefined;
    const minTier = String(req.query.minTier || "").trim().toUpperCase() as Tier | "";
    const limitQ = Number(req.query.limit ?? 0);

    // Per-request tiers + band selection
    const { allow: allowTiers, prefer: preferTier, preferWasSmall } = parseTiersParam(req);
    const bandSel = (() => {
      const sel = bandSelector(req);
      // If user preferred small (C) and provided no band at all, allow COOL by default
      if (sel.mode === "min" && !req.query.minBand && !req.query.band && !req.query.bands) {
        return { mode: "min" as const, min: preferWasSmall ? "COOL" : (sel.min || "WARM") };
      }
      return sel;
    })();

    // Overlays
    const tagsQ    = uniqLower(String(req.query.tags || "").split(","));
    const sectorsQ = uniqLower(String(req.query.sectors || "").split(","));

    // Cap by plan
    const cap = capResults("free", limitQ);

    // Effective prefs
    const basePrefs =
      (typeof (Prefs as any).getEffective === "function" && (Prefs as any).getEffective(host)) ||
      (typeof (Prefs as any).getEffectivePrefs === "function" && (Prefs as any).getEffectivePrefs(host)) ||
      (typeof (Prefs as any).get === "function" && (Prefs as any).get(host)) ||
      {};

    const mergedPrefs = {
      ...basePrefs,
      city: cityQ || (basePrefs.city || "").trim(),
      categoriesAllow: [...new Set<string>([...(basePrefs.categoriesAllow || []), ...tagsQ, ...sectorsQ])],
    };

    // Pull real candidates from the web
    const sizeQ = String(req.query.size || "").trim().toLowerCase() || undefined;
    const web = await findBuyersFromWeb({
      hostSeed: host,
      city: mergedPrefs.city || undefined,
      size: sizeQ as any,
      limit: Math.max(10, cap || 30) // fetch a bit more than we’ll return
    });

    // Filter by allowed tiers + optional minTier
    const filtered = web.filter((c) => {
      const t = getTier(c as any);
      if (!allowTiers.has(t)) return false;
      if (minTier === "A" && t !== "A") return false;
      if (minTier === "B" && t === "C") return false;
      return true;
    });

    // Score (+ optional preferTier boost)
    const scored = filtered.map((c) => {
      let { score, reasons } = safeScoreRow(c, mergedPrefs, mergedPrefs.city);
      const t = getTier(c as any);
      if (preferTier && t === preferTier) { score += 8; reasons = [...reasons, `prefer:${t}`]; }
      const band = bandFromScore(score);
      const u = uncertainty(score);
      const name = (c as any).name || prettyHostName((c as any).host);
      const url = (c as any).url || `https://${(c as any).host}`;
      const tier = t;
      return { ...(c as any), name, url, tier, score, band, uncertainty: u, reasons: (reasons || []).slice(0, 12) };
    });

    // Apply band selection
    let items = scored;
    if (bandSel.mode === "min") {
      const floor = bandSel.min || "WARM";
      const val = { HOT: 3, WARM: 2, COOL: 1 } as const;
      items = items.filter(x => val[x.band] >= val[floor]);
    } else {
      const want = bandSel.set || new Set<Band>(["HOT","WARM","COOL"]);
      items = items.filter(x => want.has(x.band));
    }

    // Sort HOT→WARM→COOL by score; then cap
    const hot  = items.filter(x => x.band === "HOT").sort((a,b)=>b.score-a.score);
    const warm = items.filter(x => x.band === "WARM").sort((a,b)=>b.score-a.score);
    const cool = items.filter(x => x.band === "COOL").sort((a,b)=>b.score-a.score);
    items = [...hot, ...warm, ...cool];

    const totalBeforeCap = items.length;
    if (cap > 0) items = items.slice(0, cap);

    // Enrich a couple uncertain via local classifier (optional)
    const MAX_ESCALATE = 2;
    const targets = [...items].filter(x => x.uncertainty >= 0.6).sort((a,b)=>b.uncertainty-a.uncertainty).slice(0, MAX_ESCALATE);
    for (const t of targets) {
      try {
        const url = `http://127.0.0.1:${CFG.port}/api/classify?host=${encodeURIComponent(t.host)}`;
        const res2 = await F(url, { redirect: "follow" });
        if (res2?.ok) {
          const data = await res2.json();
          if (data?.evidence?.length) t.reasons = [...t.reasons, ...data.evidence.map((e: string)=>`classify:${e}`)].slice(0, 12);
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
      minBandApplied: bandSel.mode === "min" ? (bandSel.min || null) : null,
      bandsApplied: bandSel.mode !== "min" ? Array.from(bandSel.set || []) : null,
      ms: Date.now() - t0,
    };

    emit("find_buyers", { host, ...summary }).catch(() => {});
    return res.json({ ok: true, items, summary });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "find-buyers-failed", detail: msg });
  }
});

export default r;