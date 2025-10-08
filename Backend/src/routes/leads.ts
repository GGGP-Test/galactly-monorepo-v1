// Backend/src/routes/leads.ts
//
// Catalog-first buyer discovery with scoring, per-request tiers, and plan gating.
// - HOT minBand is gated to WARM for free users unless admin override.
// - Accepts tiers=A,B,C or size=small|medium|large (maps to C/B/A).
// - Optional preferTier / preferSize boost.
// - Returns rich `summary` for the UI.
//
// Endpoints:
//   GET /api/leads/ping
//   GET /api/leads/find-buyers
//   GET /api/leads/find
//
// Query:
//   host=acme.com
//   &city=San+Diego
//   &limit=24
//   &tiers=A,B,C | size=small|medium|large
//   &preferTier=A|B|C | preferSize=small|medium|large
//   &minTier=A|B|C (optional additional floor)
//   &minBand=COOL|WARM|HOT (HOT gated for free unless admin)
//   &tags=t1,t2&sectors=s1,s2 (overlay into categories)
//
// Headers considered:
//   x-user-plan: free|pro|scale
//   x-user-email: optional
//   x-user-domain: optional
//   x-admin-key | x-admin-token: admin override
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Router, type Request, type Response } from "express";
import { CFG, capResults } from "../shared/env";
import * as CatalogMod from "../shared/catalog";
import * as Prefs from "../shared/prefs";
import * as TRC from "../shared/trc";
import * as PlanFlagsMod from "../shared/plan-flags";

const r = Router();
const F: (url: string, init?: any) => Promise<any> = (globalThis as any).fetch;

// tolerate default/named exports for catalog + plan-flags
const Catalog: any = (CatalogMod as any)?.default ?? (CatalogMod as any);
const PlanFlags: any = (PlanFlagsMod as any)?.default ?? (PlanFlagsMod as any);

/* ------------------------------- types ---------------------------------- */

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
  reasons: string[];
  url: string;
  name: string;
  tier: Tier;
};

/* ------------------------------- utils ---------------------------------- */

function uniqLower(arr: unknown): string[] {
  const set = new Set<string>();
  if (Array.isArray(arr)) {
    for (const v of arr) {
      const s = String(v ?? "").trim().toLowerCase();
      if (s) set.add(s);
    }
  }
  return [...set];
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
  const t = (Array.isArray(c.tiers) ? c.tiers[0] : undefined) as any;
  return t === "A" || t === "B" ? t : "C";
}

function prettyHostName(h: string): string {
  const stem = String(h || "").replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ");
  return stem.replace(/\b\w/g, (m) => m.toUpperCase());
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

const HOT_T  = Number((TRC as any)?.HOT_MIN  ?? 80);
const WARM_T = Number((TRC as any)?.WARM_MIN ?? 55);

function bandFromScore(score: number): Band {
  if (typeof (TRC as any)?.classifyScore === "function") {
    try { return (TRC as any).classifyScore(score) as Band; } catch {}
  }
  return score >= HOT_T ? "HOT" : score >= WARM_T ? "WARM" : "COOL";
}

function bandRank(b: Band): number { return b === "HOT" ? 3 : b === "WARM" ? 2 : 1; }
function meetsMin(b: Band, min?: Band): boolean { return !min ? true : bandRank(b) >= bandRank(min); }

function safeScoreRow(row: Candidate, prefs: any, city?: string) {
  // Prefer TRC.scoreRow if present
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

const SIZE_TO_TIER: Record<string, Tier> = {
  large: "A", l: "A",
  medium: "B", m: "B",
  small: "C", s: "C"
};

function parseTiersParam(req: Request): {
  allow: Set<Tier>;
  prefer?: Tier;
} {
  const envAllow = new Set<Tier>(Array.from(CFG.allowTiers ?? new Set(["A","B","C"])) as Tier[]);
  const tiersQ = String(req.query.tiers || "").trim();
  const sizeQ  = String(req.query.size  || "").trim().toLowerCase();

  let hardAllow: Set<Tier> | null = null;
  if (tiersQ) {
    const set = new Set<Tier>();
    for (const t of tiersQ.split(",").map((s) => s.trim().toUpperCase())) {
      if (t === "A" || t === "B" || t === "C") set.add(t as Tier);
    }
    if (set.size) hardAllow = set;
  } else if (sizeQ && SIZE_TO_TIER[sizeQ]) {
    hardAllow = new Set([SIZE_TO_TIER[sizeQ]]);
  }

  const allow = hardAllow
    ? new Set<Tier>([...hardAllow].filter((t) => envAllow.has(t as Tier)) as Tier[])
    : envAllow;

  const preferT = String(req.query.preferTier || "").trim().toUpperCase();
  const preferS = String(req.query.preferSize || "").trim().toLowerCase();
  let prefer: Tier | undefined;
  if (preferT === "A" || preferT === "B" || preferT === "C") prefer = preferT as Tier;
  else if (preferS && SIZE_TO_TIER[preferS]) prefer = SIZE_TO_TIER[preferS];

  return { allow, prefer };
}

async function emit(kind: string, data: any) {
  try {
    const url = `http://127.0.0.1:${CFG.port}/api/events/ingest`;
    await F(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, at: new Date().toISOString(), data }),
    });
  } catch {}
}

/* -------------------------------- routes --------------------------------- */

r.get("/ping", (_req, res) => res.json({ pong: true, at: new Date().toISOString() }));

async function handleFind(req: Request, res: Response) {
  const t0 = Date.now();
  try {
    const host = String(req.query.host || req.query.domain || "").trim().toLowerCase();
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    const city = String(req.query.city || "").trim() || undefined;
    const limitQ = Math.max(1, Math.min(100, Number(req.query.limit ?? 24) || 24));

    // ---------- identity + gating ----------
    const id = typeof PlanFlags.readIdentityFromHeaders === "function"
      ? PlanFlags.readIdentityFromHeaders(req.headers as any)
      : { plan: (String(req.header("x-user-plan")||"free").toLowerCase() || "free"), adminOverride: !!(req.header("x-admin-key")||req.header("x-admin-token")) };

    const plan: "free"|"pro"|"scale" = (id.plan === "pro" || id.plan === "scale") ? id.plan : "free";
    const admin = !!id.adminOverride;

    // minBand request + plan gating (gate HOT→WARM for free unless admin)
    const rawMin = String(req.query.minBand || "").trim().toUpperCase() as Band;
    const requestedMin: Band | undefined =
      rawMin === "HOT" ? "HOT" : rawMin === "WARM" ? "WARM" : rawMin === "COOL" ? "COOL" : undefined;

    let minBandApplied: Band | undefined = requestedMin;
    let gated = false;
    if (!admin && plan === "free" && requestedMin === "HOT") {
      minBandApplied = "WARM";
      gated = true;
    }

    // ---------- tiers (query) ----------
    const { allow: allowTiersQuery, prefer: preferTierQuery } = parseTiersParam(req);
    const minTier = String(req.query.minTier || "").trim().toUpperCase() as Tier | "";

    // (optional) plan default preferTier helper
    const preferTierPlan: Tier | undefined =
      typeof PlanFlags.defaultPreferTier === "function" ? PlanFlags.defaultPreferTier(host) : undefined;

    const preferTier: Tier | undefined = preferTierQuery || preferTierPlan;

    // final allowed tiers: env ∩ query (plan may later add its own policy; if you add that, intersect here)
    const allowTiers = allowTiersQuery;

    // cap by plan
    const cap = capResults(plan === "free" ? "free" : "pro", limitQ);

    // overlays from query
    const overlayTags = [...new Set<string>([
      ...uniqLower(String(req.query.tags || "").split(",")),
      ...uniqLower(String(req.query.sectors || "").split(",")),
    ])];

    // prefs baseline
    const basePrefs =
      (typeof (Prefs as any).getEffective === "function" && (Prefs as any).getEffective(host)) ||
      (typeof (Prefs as any).getEffectivePrefs === "function" && (Prefs as any).getEffectivePrefs(host)) ||
      (typeof (Prefs as any).get === "function" && (Prefs as any).get(host)) ||
      {};

    const prefs = {
      ...basePrefs,
      city,
      categoriesAllow: [...new Set<string>([...(basePrefs.categoriesAllow || []), ...overlayTags])],
    };

    // ---------- pool ----------
    const pool = getCatalogRows();

    // ---------- score + band + filter ----------
    let scored = pool
      .filter((c) => {
        const t = getTier(c);
        if (!allowTiers.has(t)) return false;
        if (minTier === "A" && t !== "A") return false;
        if (minTier === "B" && t === "C") return false;
        return true;
      })
      .map((c) => {
        let { score, reasons } = safeScoreRow(c, prefs, city);
        if (preferTier && getTier(c) === preferTier) { score += 8; reasons = [...reasons, `prefer:${preferTier}`]; }
        const band = bandFromScore(score);
        const url = c.url || `https://${c.host}`;
        const name = c.name || c.company || prettyHostName(c.host);
        return { ...c, name, url, tier: getTier(c), score, band, reasons: (reasons || []).slice(0, 12) } as Scored;
      });

    if (minBandApplied) scored = scored.filter(x => meetsMin(x.band, minBandApplied));

    // order by score desc
    const ordered = scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    const items = ordered.slice(0, cap);

    const summary = {
      ok: true,
      returned: items.length,
      plan,
      adminOverride: admin,
      requested: limitQ,
      capApplied: cap,
      city: city || null,
      tiersApplied: Array.from(allowTiers),
      preferTier: preferTier || null,
      minTier: minTier || null,
      minBandRequested: requestedMin || null,
      minBandApplied: minBandApplied || null,
      gated,
      hot: items.filter(i=>i.band==="HOT").length,
      warm: items.filter(i=>i.band==="WARM").length,
      cool: items.filter(i=>i.band==="COOL").length,
      overlays: { tags: overlayTags.slice(0,12) },
      ms: Date.now() - t0,
      source: "catalog",
    };

    await emit("find_buyers_catalog", { host, ...summary }).catch(() => {});
    return res.json({ ok: true, items, summary });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "catalog-find-buyers-failed", detail: msg });
  }
}

r.get("/find-buyers", handleFind);
r.get("/find", handleFind);

export default r;