// src/routes/leads.ts
//
// Artemis B v1 — Buyer discovery with per-request tier/band controls
// + plan gating (shared/plan-flags) and dynamic caps by plan.
//
// GET /api/leads/ping
// GET /api/leads/find-buyers?host=acme.com[&city=&tags=&sectors=&minTier=&limit=]
// Optional headers for plan gating:
//   x-user-email, x-user-plan (free|pro|scale), x-admin-key (bypass gating)

import { Router, type Request, type Response } from "express";
import { CFG, capResults } from "../shared/env";
import * as CatalogMod from "../shared/catalog";
import * as Prefs from "../shared/prefs";
import * as TRC from "../shared/trc";
import * as Plan from "../shared/plan-flags";

const r = Router();

type Tier = "A" | "B" | "C";
type Band = "HOT" | "WARM" | "COOL";

type Candidate = {
  host: string;
  name?: string;
  company?: string;
  city?: string;
  url?: string;
  tier?: Tier;
  tiers?: Tier[];
  tags?: string[];
  segments?: string[];
  size?: "micro" | "small" | "mid" | "large";
  [k: string]: any;
};

type Scored = Candidate & {
  score: number;
  band: Band;
  uncertainty: number;
  reasons: string[];
  tier: Tier;
  url: string;
  name: string;
};

const Catalog: any = (CatalogMod as any)?.default ?? (CatalogMod as any);
const F: (url: string, init?: any) => Promise<any> = (globalThis as any).fetch;

// ---------- tiny helpers ----------
function uniqLower(arr: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(arr)) {
    for (const v of arr) {
      const s = String(v ?? "").trim().toLowerCase();
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    }
  }
  return out;
}
function getCatalogRows(): Candidate[] {
  const c: any = Catalog;
  if (typeof c?.get === "function") return c.get();
  if (typeof c?.rows === "function") return c.rows();
  if (Array.isArray(c?.rows)) return c.rows as Candidate[];
  if (Array.isArray(c?.catalog)) return c.catalog as Candidate[];
  if (typeof c?.all === "function") return c.all();
  return [];
}
function getTier(c: Candidate): Tier {
  if (c.tier === "A" || c.tier === "B" || c.tier === "C") return c.tier;
  const t = Array.isArray(c.tiers) ? c.tiers[0] : undefined;
  return t === "A" || t === "B" ? t : "C";
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
  return score >= HOT_T ? "HOT" : (score >= WARM_T ? "WARM" : "COOL");
}
function uncertainty(score: number): number {
  const dHot = Math.abs(score - HOT_T);
  const dWarm = Math.abs(score - WARM_T);
  const d = Math.min(dHot, dWarm);
  const u = 1 - d / 10;
  const safe = Math.max(0, Math.min(1, u));
  return Number(safe.toFixed(3));
}
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

// -------- request-tier parsing (tiers/size + preferTier/preferSize) --------
const SIZE_TO_TIER: Record<string, Tier> = { large: "A", l: "A", medium: "B", m: "B", small: "C", s: "C" };

function parseTiersParam(req: Request): {
  allow: Set<Tier>;
  prefer?: Tier;
  preferWasSmall: boolean;
} {
  const envAllow = new Set<Tier>(Array.from(CFG.allowTiers ?? new Set<Tier>(["A","B","C"])) as Tier[]);
  const tiersQ = String(req.query.tiers || "").trim();
  const sizeQ  = String(req.query.size  || "").trim().toLowerCase();

  let hardAllow: Set<Tier> | null = null;
  if (tiersQ) {
    const set = new Set<Tier>();
    for (const t of tiersQ.split(",").map(s => s.trim().toUpperCase())) {
      if (t === "A" || t === "B" || t === "C") set.add(t as Tier);
    }
    if (set.size > 0) hardAllow = set;
  } else if (sizeQ && SIZE_TO_TIER[sizeQ]) {
    hardAllow = new Set<Tier>([SIZE_TO_TIER[sizeQ]]);
  }

  const allow: Set<Tier> = hardAllow
    ? new Set<Tier>(Array.from(hardAllow).filter(t => envAllow.has(t)))
    : envAllow;

  const preferT = String(req.query.preferTier || "").trim().toUpperCase();
  const preferS = String(req.query.preferSize || "").trim().toLowerCase();

  let prefer: Tier | undefined;
  if (preferT === "A" || preferT === "B" || preferT === "C") {
    prefer = preferT as Tier;
  } else if (preferS && SIZE_TO_TIER[preferS]) {
    prefer = SIZE_TO_TIER[preferS];
  }

  const preferWasSmall = prefer === "C";
  return { allow, prefer, preferWasSmall };
}

// ---------------------------- scoring (fallback) ---------------------------
function cityBoost(city?: string, candidateCity?: string): number {
  if (!city || !candidateCity) return 0;
  const a = city.trim().toLowerCase();
  const b = candidateCity.trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 0.15;
  if (b.includes(a) || a.includes(b)) return 0.1;
  return 0;
}
function safeScoreRow(row: Candidate, prefs: any, city?: string) {
  if (typeof (TRC as any)?.scoreRow === "function") {
    try {
      const out = (TRC as any).scoreRow(row, prefs, city);
      if (out && typeof out.score === "number") return out;
    } catch { /* fall through */ }
  }
  let score = 50;
  const reasons: string[] = [];
  const loc = cityBoost(city || (prefs?.city as string), row.city);
  if (loc) { score += loc * 100; reasons.push(`local+${(loc * 100) | 0}`); }

  const want = new Set<string>(uniqLower(prefs?.categoriesAllow || []));
  if (want.size > 0) {
    const have = new Set<string>([
      ...uniqLower(row.tags || []),
      ...uniqLower(row.segments || []),
    ]);
    let hits = 0;
    want.forEach((t) => { if (have.has(t)) hits++; });
    if (hits > 0) { score += Math.min(15, hits * 5); reasons.push(`tags+${hits}`); }
  }

  const sw = prefs?.sizeWeight || {};
  if (typeof sw === "object") {
    const sz = String((row as any)?.size || "").toLowerCase();
    let w = 0;
    if (sz === "micro") w = Number(sw.micro ?? 0);
    else if (sz === "small") w = Number(sw.small ?? 0);
    else if (sz === "mid") w = Number(sw.mid ?? 0);
    else if (sz === "large") w = Number(sw.large ?? 0);
    if (w) { score += Math.max(-12, Math.min(12, w * 4)); reasons.push(`size:${sz || "?"}`); }
  }

  const sig = prefs?.signalWeight || {};
  if (sig && (sig.ecommerce || sig.retail || sig.wholesale)) {
    const add = (Number(sig.ecommerce || 0) + Number(sig.retail || 0) + Number(sig.wholesale || 0)) * 2;
    score += Math.min(6, add);
    reasons.push("signals");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}

// --------------------------------- routes ---------------------------------
r.get("/ping", (_req: Request, res: Response) => res.json({ pong: true, at: new Date().toISOString() }));

r.get("/find-buyers", async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const host = String(req.query.host || req.query.domain || "").trim().toLowerCase();
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    const cityQ = String(req.query.city || "").trim();
    const minTierQ = String(req.query.minTier || "").trim().toUpperCase() as Tier | "";
    const limitQ = Number(req.query.limit ?? 0);

    // Per-request tier controls (from query)…
    const qTiers = parseTiersParam(req);

    // …then apply plan gating (from headers)
    const ident = Plan.readIdentityFromHeaders(req.headers as any);
    const requestedMinBandRaw = String(req.query.minBand || req.query.bandMin || "").trim().toUpperCase() as Band | "";
    const requestedMinBand: Band =
      requestedMinBandRaw === "HOT" || requestedMinBandRaw === "WARM" || requestedMinBandRaw === "COOL"
        ? requestedMinBandRaw
        : (qTiers.preferWasSmall ? "COOL" : "WARM");

    const decision = Plan.applyBandPolicy(ident.plan, requestedMinBand, ident.adminOverride);

    // Intersect allowed tiers (env + query) with plan policy tiers
    const policyTiers = new Set<Tier>(decision.tiersApplied as Tier[]);
    const allowTiers = new Set<Tier>(Array.from(qTiers.allow).filter(t => policyTiers.has(t)));

    // Prefer tier: query wins; else plan hint; else none
    const preferTier = (qTiers.prefer || decision.preferTier || undefined) as Tier | undefined;

    // minBand actually applied after gating:
    const minBand = decision.exactBand;

    const bandOrder: Record<Band, number> = { HOT: 3, WARM: 2, COOL: 1 };

    // Overlays
    const tagsQ    = uniqLower(String(req.query.tags || "").split(","));
    const sectorsQ = uniqLower(String(req.query.sectors || "").split(","));
    const overlayTags = Array.from(new Set<string>([...tagsQ, ...sectorsQ]));

    // Dynamic cap by plan (plan-flags uses free|pro|scale; env.capResults wants free|pro|ultimate)
    const planForCap = ident.plan === "pro" || ident.plan === "scale" ? "pro" : "free";
    const cap = capResults(planForCap, limitQ);

    // Effective prefs
    const basePrefs =
      (typeof (Prefs as any).getEffective === "function" && (Prefs as any).getEffective(host)) ||
      (typeof (Prefs as any).getEffectivePrefs === "function" && (Prefs as any).getEffectivePrefs(host)) ||
      (typeof (Prefs as any).get === "function" && (Prefs as any).get(host)) ||
      {};

    const mergedPrefs = {
      ...basePrefs,
      city: (cityQ || basePrefs.city || "").trim(),
      categoriesAllow: Array.from(new Set<string>([...(basePrefs.categoriesAllow || []), ...overlayTags])),
    };

    const rows: Candidate[] = getCatalogRows();

    // Filter by allowed tiers + optional minTier (from query)
    const filtered: Candidate[] = rows.filter((c) => {
      const t = getTier(c);
      if (!allowTiers.has(t)) return false;
      if (minTierQ === "A" && t !== "A") return false;
      if (minTierQ === "B" && t === "C") return false;
      return true;
    });

    // Score (+ optional preferTier boost)
    const scored: Scored[] = filtered.map((c): Scored => {
      const s = safeScoreRow(c, mergedPrefs, mergedPrefs.city);
      let score = s.score;
      let reasons = Array.isArray(s.reasons) ? s.reasons.slice(0, 12) : [];

      const t = getTier(c);
      if (preferTier && t === preferTier) {
        score += 8;
        reasons = reasons.concat([`prefer:${t}`]).slice(0, 12);
      }

      const b: Band = bandFromScore(score);
      const u = uncertainty(score);
      const name = (c.name || c.company || prettyHostName(c.host)) as string;
      const url = (c.url || `https://${c.host}`) as string;

      return { ...c, host: c.host, name, city: c.city, tier: t, url, score, band: b, uncertainty: u, reasons };
    });

    // Keep at/above minBand (after gating)
    const kept: Scored[] = scored.filter((x) => bandOrder[x.band] >= bandOrder[minBand]);

    // Sort HOT→WARM→COOL by score
    const hot  = kept.filter((x) => x.band === "HOT").sort((a, b) => b.score - a.score);
    const warm = kept.filter((x) => x.band === "WARM").sort((a, b) => b.score - a.score);
    const cool = kept.filter((x) => x.band === "COOL").sort((a, b) => b.score - a.score);
    let items: Scored[] = hot.concat(warm, cool);

    const totalBeforeCap = items.length;
    if (cap > 0) items = items.slice(0, cap);

    // Opportunistic enrichment for uncertain rows
    const MAX_ESCALATE = 2;
    const targets = items
      .filter((x) => x.uncertainty >= 0.6)
      .sort((a, b) => b.uncertainty - a.uncertainty)
      .slice(0, MAX_ESCALATE);

    for (const t of targets) {
      try {
        const url = `http://127.0.0.1:${CFG.port}/api/classify?host=${encodeURIComponent(t.host)}`;
        const res2 = await F(url, { redirect: "follow" });
        if (res2?.ok) {
          const data = await res2.json().catch(() => null);
          if (data && Array.isArray(data.evidence) && data.evidence.length) {
            const addReasons = data.evidence.slice(0, 4).map((e: string) => `classify:${String(e)}`);
            t.reasons = t.reasons.concat(addReasons).slice(0, 12);
          }
          if (data && data.role) {
            const conf = Number(data.confidence ?? 0);
            t.reasons = t.reasons.concat([`role:${String(data.role)}@${conf.toFixed(2)}`]).slice(0, 12);
          }
        }
      } catch { /* ignore */ }
    }

    const gating = Plan.summarizeGating(ident.plan, requestedMinBand, ident.adminOverride);
    const summary = {
      requested: limitQ || null,
      returned: items.length,
      hot: items.filter((x) => x.band === "HOT").length,
      warm: items.filter((x) => x.band === "WARM").length,
      cool: items.filter((x) => x.band === "COOL").length,
      totalBeforeCap,
      capApplied: cap,
      city: mergedPrefs.city || null,
      minTier: minTierQ || null,
      tiersApplied: Array.from(allowTiers),
      preferTier: preferTier || null,
      minBandRequested: requestedMinBand,
      minBandApplied: minBand,
      gating,
      overlays: { tags: overlayTags.slice(0, 12) },
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