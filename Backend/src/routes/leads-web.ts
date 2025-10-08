// src/routes/leads-web.ts
//
// Web-first buyer discovery with exact band filtering (server-side),
// route aliasing, and stricter web-host filtering.
// Routes (both work):
//   GET /api/web/find
//   GET /api/web/find-buyers
//
// Query:
//   host=acme.com&city=&size=small|medium|large&limit=10
//   &band=COOL|WARM|HOT
//   &mode=web|hybrid|catalog&shareWeb=0.3
//   &tiers=A,B,C&preferTier=C&preferSize=small
//
// Defaults changed:
//   - mode defaults to "web" (previously hybrid)
//   - we drop aggregator hosts (maps.google.com, facebook.com, etc.)

import { Router, type Request, type Response } from "express";
import { CFG, capResults } from "../shared/env";
import * as Prefs from "../shared/prefs";
import * as CatalogMod from "../shared/catalog";
import * as Sources from "../shared/sources";
import { scoreBuyer } from "../shared/score";

/* eslint-disable @typescript-eslint/no-explicit-any */

const r = Router();
const F: (url: string, init?: any) => Promise<any> = (globalThis as any).fetch;

// Normalize default vs named export from catalog.ts
const Catalog: any = (CatalogMod as any)?.default ?? (CatalogMod as any);

// ---------------------- local types + utils ----------------------

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
  provider?: "places" | "osm" | "catalog";
  score?: number;
  band?: Band;
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
function mapLabelToBand(label: "hot" | "warm" | "cold"): Band {
  return label === "hot" ? "HOT" : label === "warm" ? "WARM" : "COOL";
}

// Drop aggregator/non-outreach domains
const BAD_HOST_RE = /(^(?:maps\.|www\.)?google\.[a-z.]+$)|(^facebook\.com$)|(^instagram\.com$)|(^yelp\.com$)|(^tripadvisor\.[a-z.]+$)|(^linkedin\.com$)/i;
function isOutreachableHost(h?: string) {
  if (!h) return false;
  const host = String(h).toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return false;
  if (BAD_HOST_RE.test(host)) return false;
  return true;
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

// ------------------------------- route -------------------------------

// Alias both paths so Admin can call /web/find OR /web/find-buyers
r.get(["/find", "/find-buyers"], async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const host = String(req.query.host || req.query.domain || "").trim().toLowerCase();
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    const city  = String(req.query.city || "").trim() || undefined;
    const sizeQ = String(req.query.size || "").trim().toLowerCase() || undefined;
    const limitQ = Math.max(1, Math.min(100, Number(req.query.limit ?? 10) || 10));

    // exact band required
    const bandQ = String(req.query.band || "").trim().toUpperCase();
    const band: Band = bandQ === "HOT" ? "HOT" : bandQ === "WARM" ? "WARM" : "COOL";

    // mode + hybrid share (DEFAULT NOW = "web")
    const mode = (String(req.query.mode || "web").trim().toLowerCase()) as "web" | "catalog" | "hybrid";
    const shareWeb = Math.max(0, Math.min(1, Number(req.query.shareWeb ?? 0.3)));

    // tiers
    const { allow: allowTiers, prefer: preferTier } = parseTiersParam(req);

    // caps by plan
    const cap = capResults("free", limitQ);

    // prefs baseline
    const basePrefs =
      (typeof (Prefs as any).getEffective === "function" && (Prefs as any).getEffective(host)) ||
      (typeof (Prefs as any).getEffectivePrefs === "function" && (Prefs as any).getEffectivePrefs(host)) ||
      (typeof (Prefs as any).get === "function" && (Prefs as any).get(host)) ||
      {};
    const prefs = { ...basePrefs, city, categoriesAllow: [...new Set<string>(basePrefs?.categoriesAllow || [])] };

    // ---------- fetch pools ----------
    let wantWeb = 0, wantCat = 0;
    if (mode === "web") { wantWeb = cap; }
    else if (mode === "catalog") { wantCat = cap; }
    else { // hybrid
      wantWeb = Math.round(cap * shareWeb);
      wantCat = cap - wantWeb;
    }

    // WEB
    let webRows: Candidate[] = [];
    if (wantWeb > 0) {
      const webFound = await Sources.findBuyersFromWeb({
        hostSeed: host,
        city,
        size: (sizeQ as any) || undefined,
        limit: wantWeb * 3, // overfetch a bit
      }).catch(() => []);
      webRows = (Array.isArray(webFound) ? webFound : [])
        .map((w: any) => ({
          host: w.host, name: w.name, city: w.city, url: w.url, tier: (w.tier as Tier|undefined),
          tags: w.tags || [], provider: w.provider || "places"
        }))
        // NEW: keep only real, outreachable domains (no maps / socials)
        .filter((w) => isOutreachableHost(w.host));
    }

    // CATALOG
    let catRows: Candidate[] = [];
    if (wantCat > 0) {
      const rows = getCatalogRows();
      catRows = (Array.isArray(rows) ? rows.slice() : []).map(r => ({ ...r, provider: "catalog" }));
    }

    // Merge pools
    const pool: Candidate[] = [...webRows, ...catRows];

    // ---------- score + exact band ----------
    const scored = pool
      .filter((c) => allowTiers.has(getTier(c)))
      .map((c) => {
        const t = getTier(c);
        const rowLike = {
          host: c.host,
          tiers: [t],
          tags: uniqLower(c.tags || []),
          segments: uniqLower(c.segments || []),
          cityTags: c.city ? [String(c.city).trim().toLowerCase()] : [],
        };
        const s = scoreBuyer({ row: rowLike as any, prefs });
        const b = mapLabelToBand(s.label);
        const name = c.name || c.company || prettyHostName(c.host);
        const url = c.url || `https://${c.host}`;
        const reasons = [...(s.reasons || [])];
        if (preferTier && t === preferTier) reasons.push(`prefer:${t}`);
        return { ...c, name, url, score: s.total, band: b, reasons: reasons.slice(0, 12) };
      })
      .filter((x) => x.band === band);

    // Dedup by host
    const seen = new Set<string>();
    const deduped = scored.filter((x) => {
      const h = (x.host || "").toLowerCase();
      if (!h || seen.has(h)) return false;
      seen.add(h);
      return true;
    });

    // Prefer web rows first when hybrid; else by score
    const sortWebFirst = (a: Candidate, b: Candidate) => {
      const aw = (a.provider === "places" || a.provider === "osm") ? 1 : 0;
      const bw = (b.provider === "places" || b.provider === "osm") ? 1 : 0;
      if (aw !== bw) return bw - aw; // web over catalog
      return (b.score || 0) - (a.score || 0);
    };
    const ordered = mode === "hybrid" ? deduped.sort(sortWebFirst) : deduped.sort((a, b) => (b.score || 0) - (a.score || 0));

    let items = ordered.slice(0, cap);

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
});

export default r;