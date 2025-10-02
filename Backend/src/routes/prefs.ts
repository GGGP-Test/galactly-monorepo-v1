// src/routes/prefs.ts
//
// Preferences/Persona API used by free-panel.html
// Endpoints:
//   GET  /api/prefs/ping
//   GET  /api/prefs/:host              -> effective prefs (safe defaults if none set)
//   GET  /api/prefs?host=acme.com      -> same as above (query form)
//   POST /api/prefs/upsert             -> upsert from panel payload, returns effective prefs
//
// Notes
// - Stores data in the shared in-memory prefs store (no DB needed).
// - Maps free-panel payload to shared/prefs fields.
// - Unknown fields are ignored; inputs are clamped/sanitized.
// - NEW: supports inboundOptIn (supplier opts in to inbound directory)

import { Router, Request, Response } from "express";
import {
  setPrefs,
  getPrefs,
  prefsSummary,
  normalizeHost as normHostShared,
  type EffectivePrefs,
} from "../shared/prefs";

const r = Router();

/* -------------------------------------------------------------------------- */
/* Types (panel payload)                                                      */
/* -------------------------------------------------------------------------- */

type SliderMetric = { label: string; value?: number };

type PanelPayload = {
  host?: string;

  // one-liner (kept for future use; not persisted here)
  lineText?: string;
  line?: {
    host?: string;
    verb?: string;
    products?: string;
    audience?: string;
    region?: string;
    contacts?: string;
  };

  productTags?: string[];
  sectorHints?: string[];

  general?: {
    mids?: boolean;
    avoidBig?: boolean;
    near?: boolean;
    ecom?: boolean;
    retail?: boolean;
    wholesale?: boolean;
  };

  metrics?: SliderMetric[];

  targeting?: {
    city?: string;
    sectors?: string; // free text; we split to tags
  };

  // NEW: supplier wants to be listed for inbound buyer traffic
  inboundOptIn?: boolean;

  // Optional future knobs (ignored if absent)
  titlesPreferred?: string[];
  materialsAllow?: string[];
  materialsBlock?: string[];
  certsRequired?: string[];
  excludeHosts?: string[];
  keywordsAdd?: string[];
  keywordsAvoid?: string[];
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normHost(input?: string): string {
  return normHostShared(String(input || ""));
}

function bool(v: unknown, d = false): boolean {
  return typeof v === "boolean" ? v : d;
}

function clip(n: unknown, lo: number, hi: number, d: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return d;
  return Math.max(lo, Math.min(hi, x));
}

function uniqLower(arr: unknown): string[] {
  const set = new Set<string>();
  if (Array.isArray(arr)) {
    for (const v of arr) {
      const s = String(v || "").trim().toLowerCase();
      if (s) set.add(s);
    }
  }
  return [...set];
}

/**
 * Map free-panel payload -> patch for shared/prefs.setPrefs()
 * We keep it intentionally simple and deterministic:
 * - preferSmallMid from general.mids
 * - sizeWeight.large down-weighted if general.avoidBig
 * - signalWeight.local boosted if general.near
 * - signalWeight.{ecommerce,retail,wholesale} nudged from toggles
 * - categoriesAllow from productTags + sectorHints + targeting.sectors (split)
 * - city from targeting.city
 * - inboundOptIn forwarded as-is (default false)
 * - titles/materials/certs/exclude/keywords forwarded if present (optional)
 */
function toPrefsPatch(p: PanelPayload) {
  const preferSmallMid = bool(p.general?.mids, true);
  const avoidBig = bool(p.general?.avoidBig, true);
  const near = bool(p.general?.near, true);

  // Base weights; tuned for sensible defaults
  const sizeWeight = {
    micro: preferSmallMid ? 1.2 : 0.6,
    small: preferSmallMid ? 1.0 : 0.6,
    mid: preferSmallMid ? 0.6 : 0.8,
    large: avoidBig ? -1.2 : 0.2,
  };

  // Start from mild baseline and nudge based on toggles
  const signalWeight = {
    local: near ? 1.6 : 0.2,
    ecommerce: bool(p.general?.ecom) ? 0.35 : 0.1,
    retail: bool(p.general?.retail) ? 0.35 : 0.1,
    wholesale: bool(p.general?.wholesale) ? 0.35 : 0.1,
  };

  // Tags/segments we want to bias toward
  const tags = uniqLower([
    ...(p.productTags || []),
    ...(p.sectorHints || []),
    ...String(p.targeting?.sectors || "")
      .split(/[;,]/)
      .map((s) => s.trim()),
  ]);

  // Optional structured fields (if the UI starts sending them)
  const titlesPreferred = Array.isArray(p.titlesPreferred) ? p.titlesPreferred : undefined;
  const materialsAllow  = Array.isArray(p.materialsAllow)  ? p.materialsAllow  : undefined;
  const materialsBlock  = Array.isArray(p.materialsBlock)  ? p.materialsBlock  : undefined;
  const certsRequired   = Array.isArray(p.certsRequired)   ? p.certsRequired   : undefined;
  const excludeHosts    = Array.isArray(p.excludeHosts)    ? p.excludeHosts    : undefined;
  const keywordsAdd     = Array.isArray(p.keywordsAdd)     ? p.keywordsAdd     : undefined;
  const keywordsAvoid   = Array.isArray(p.keywordsAvoid)   ? p.keywordsAvoid   : undefined;

  const patch = {
    city: (p.targeting?.city || "").trim() || undefined,
    preferSmallMid,
    sizeWeight,
    signalWeight,
    categoriesAllow: tags,
    inboundOptIn: bool(p.inboundOptIn, false),

    // forward structured lists if present
    titlesPreferred,
    materialsAllow,
    materialsBlock,
    certsRequired,
    excludeHosts,
    keywordsAdd,
    keywordsAvoid,
  };

  return patch;
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

r.get("/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, at: new Date().toISOString() });
});

// GET /api/prefs/:host  OR  /api/prefs?host=acme.com
r.get("/", (req: Request, res: Response) => {
  const host = normHost(req.query.host as string);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });
  const prefs = getPrefs(host);
  return res.json({
    ok: true,
    host,
    prefs,
    inboundOptIn: prefs.inboundOptIn === true,
    summary: prefsSummary(prefs),
  });
});

r.get("/:host", (req: Request, res: Response) => {
  const host = normHost(req.params.host);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });
  const prefs = getPrefs(host);
  return res.json({
    ok: true,
    host,
    prefs,
    inboundOptIn: prefs.inboundOptIn === true,
    summary: prefsSummary(prefs),
  });
});

// POST /api/prefs/upsert
// Body = PanelPayload (see free-panel.html collectPersona())
r.post("/upsert", (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as PanelPayload;
    const host = normHost(body.host || body.line?.host || "");
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    // optional: clamp metric values 0..10 (even if we don't store them yet)
    const metrics: SliderMetric[] = Array.isArray(body.metrics) ? body.metrics : [];
    for (const m of metrics) {
      m.value = clip(m.value, 0, 10, 8);
    }

    const patch = toPrefsPatch(body);
    const effective: EffectivePrefs = setPrefs(host, patch);

    return res.json({
      ok: true,
      host,
      prefs: effective,
      inboundOptIn: effective.inboundOptIn === true,
      summary: prefsSummary(effective),
      accepted: {
        city: effective.city || null,
        categoriesAllow: effective.categoriesAllow.slice(0, 12),
        preferSmallMid: effective.preferSmallMid,
        sizeWeight: effective.sizeWeight,
        signalWeight: effective.signalWeight,
        inboundOptIn: effective.inboundOptIn === true,
      },
    });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "prefs-upsert-failed", detail: msg });
  }
});

export default r;