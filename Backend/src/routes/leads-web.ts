// src/routes/leads-web.ts
//
// Web-first buyer discovery with exact band filtering and optional catalog mix.
// Endpoints (both work):
//   GET /api/web/find
//   GET /api/web/find-buyers
// Query:
//   host, city, size=small|medium|large, limit=10,
//   band=COOL|WARM|HOT,
//   mode=hybrid|web|catalog, shareWeb=0.3,
//   tiers=A,B,C, preferTier=C, preferSize=small

import { Router, type Request, type Response } from "express";
import { CFG, capResults } from "../shared/env";
import * as Prefs from "../shared/prefs";
import * as TRC from "../shared/trc";
import * as CatalogMod from "../shared/catalog";
import * as Sources from "../shared/sources";

/* eslint-disable @typescript-eslint/no-explicit-any */

const r = Router();
const F: (url: string, init?: any) => Promise<any> = (globalThis as any).fetch;

const Catalog: any = (CatalogMod as any)?.default ?? (CatalogMod as any);

// ---------- types / utils ----------
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
  score?: number;
  band?: Band;
  uncertainty?: number;
  reasons?: string[];
  [k: string]: any;
};

function uniqLower(arr: unknown): string[] {
  const set = new Set<string>();
  if (Array.isArray(arr)) for (const v of arr) {
    const s = String(v ?? "").trim().toLowerCase();
    if (s) set.add(s);
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
    try { return (TRC as any).classifyScore(score); } catch { /* ignore */ }
  }
  return score >= HOT_T ? "HOT" : score >= WARM_T ? "WARM" : "COOL";
}

function uncertainty(score: number): number {
  const d = Math.min(Math.abs(score - HOT_T), Math.abs(score - WARM_T));
  const u = Math.max(0, 1 - d / 10);
  return Number.isFinite(u) ? Number(u.toFixed(3)) : 0;
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

function parseTiersParam(req: Request): { allow: Set<Tier>; prefer?: Tier } {
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

// ---------- handler ----------
async function handleFind(req: Request, res: Response) {
  const t0 = Date.now();
  try {
    const host = String(req.query.host || req.query.domain || "").trim().toLowerCase();
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    const city   = String(req.query.city || "").trim() || undefined;
    const sizeQ  = String(req.query.size || "").trim().toLowerCase() || undefined;
    const limitQ = Math.max(1, Math.min(100, Number(req.query.limit ?? 10) || 10));

    const bandQ = String(req.query.band || "").trim().toUpperCase() as Band;
    const band: Band = bandQ === "HOT" ? "HOT" : bandQ === "WARM" ? "WARM" : "COOL";

    const mode = (String(req.query.mode || "hybrid").trim().toLowerCase()) as "web" | "catalog" | "hybrid";
    const shareWeb = Math.max(0, Math.min(1, Number(req.query.shareWeb ?? 0.3)));

    const { allow: allowTiers, prefer: preferTier } = parseTiersParam(req);

    const cap = capResults("free", limitQ);

    const basePrefs =
      (typeof (Prefs as any).getEffective === "function" && (Prefs as any).getEffective(host)) ||
      (typeof (Prefs as any).getEffectivePrefs === "function" && (Prefs as any).getEffectivePrefs(host)) ||
      (typeof (Prefs as any).get === "function" && (Prefs as any).get(host)) ||
      {};

    const prefs = { ...basePrefs, city, categoriesAllow: [...new Set<string>(basePrefs?.categoriesAllow || [])] };

    // split quotas
    let wantWeb = 0, wantCat = 0;
    if (mode === "web") { wantWeb = cap; }
    else if (mode === "catalog") { wantCat = cap; }
    else { wantWeb = Math.round(cap * shareWeb); wantCat = cap - wantWeb; }

    // WEB
    let webRows: Candidate[] = [];
    if (wantWeb > 0) {
      const webFound = await Sources.findBuyersFromWeb({
        hostSeed: host, city, size: (sizeQ as any) || undefined, limit: wantWeb * 3
      }).catch(() => []);
      webRows = Array.isArray(webFound)
        ? webFound.map((w: any) => ({ host: w.host, name: w.name, city: w.city, url: w.url, tier: (w.tier as Tier|undefined), tags: w.tags || [], provider: w.provider }))
        : [];
    }

    // CATALOG
    let catRows: Candidate[] = [];
    if (wantCat > 0) {
      const rows = getCatalogRows();
      catRows = Array.isArray(rows) ? rows.slice() : [];
    }

    const pool: Candidate[] = [...webRows, ...catRows];

    // score + exact band
    const scored = pool
      .filter((c) => allowTiers.has(getTier(c)))
      .map((c) => {
        let { score, reasons } = safeScoreRow(c, prefs, city);
        const t = getTier(c);
        if (preferTier && t === preferTier) { score += 8; reasons = [...reasons, `prefer:${t}`]; }
        const b = bandFromScore(score);
        const u = uncertainty(score);
        const name = c.name || c.company || prettyHostName(c.host);
        const url = c.url || `https://${c.host}`;
        return { ...c, name, url, score, band: b, uncertainty: u, reasons: Array.isArray(reasons) ? reasons.slice(0, 12) : [] };
      })
      .filter((x) => x.band === band);

    const sortWebFirst = (a: Candidate, b: Candidate) => {
      const aw = (a as any).provider ? 1 : 0;
      const bw = (b as any).provider ? 1 : 0;
      if (aw !== bw) return bw - aw; // web first
      return (b.score || 0) - (a.score || 0);
    };

    const ordered = mode === "hybrid" ? scored.sort(sortWebFirst) : scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    const items = ordered.slice(0, cap);

    const summary = {
      ok: true,
      returned: items.length,
      band,
      mode,
      shareWeb: mode === "hybrid" ? shareWeb : (mode === "web" ? 1 : 0),
      webPool: webRows.length,
      catalogPool: catRows.length,
      tiersApplied: Array.from(allowTiers),
      preferTier: preferTier || null,
      ms: Date.now() - t0,
    };

    await emit("find_buyers_web", { host, ...summary }).catch(() => {});
    return res.json({ ok: true, items, summary });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "web-find-buyers-failed", detail: msg });
  }
}

// Register handler under **both** paths
r.get("/find", handleFind);
r.get("/find-buyers", handleFind);

export default r;