// src/routes/prefs.ts
//
// Preferences/Persona API used by free-panel.html
// Endpoints:
//   GET  /api/prefs/ping
//   GET  /api/prefs/:host
//   GET  /api/prefs?host=acme.com
//   POST /api/prefs/upsert
//
// Notes
// - Stores data in the shared in-memory prefs store (no DB).
// - Accepts richer payload (titles/materials/certs/excludes/keywords/radius)
//   but maps them into existing shared/prefs fields via prefixed tags so we
//   stay 100% backward compatible today.

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

  // New knobs we’ll accept (all optional)
  titlesPreferred?: string[];           // e.g., ["Operations","Procurement"]
  materialsAllow?: string[];            // e.g., ["PET","corrugate"]
  materialsBlock?: string[];            // e.g., ["PVC"]
  certsRequired?: string[];             // e.g., ["FDA","FSC","BRC"]
  excludeHosts?: string[];              // competitors to mute
  keywordsAdd?: string[];               // synonyms/keywords to bias toward
  keywordsAvoid?: string[];             // suppressors

  radiusKm?: number;

  general?: {
    mids?: boolean;
    avoidBig?: boolean;
    near?: boolean;
    ecom?: boolean;
    wholesale?: boolean;
    retail?: boolean;
  };

  metrics?: SliderMetric[];

  targeting?: {
    city?: string;
    sectors?: string; // free text; split by comma/semicolon
  };
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

function lowerClean(a?: unknown[]): string[] {
  const out = new Set<string>();
  if (!Array.isArray(a)) return [];
  for (const v of a) {
    const s = String(v || "").trim().toLowerCase();
    if (s) out.add(s);
  }
  return [...out];
}

function splitToLower(s?: string): string[] {
  if (!s) return [];
  return String(s)
    .split(/[;,]/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function tag(prefix: string, values: string[] | undefined): string[] {
  const out: string[] = [];
  for (const v of lowerClean(values)) out.push(`${prefix}${v}`);
  return out;
}

/**
 * Map free-panel payload -> patch for shared/prefs.setPrefs()
 * We stay inside today's schema:
 *   - city, radiusKm, preferSmallMid, sizeWeight, signalWeight
 *   - categoriesAllow / categoriesBlock (we pack richer info via prefixes)
 */
function toPrefsPatch(p: PanelPayload) {
  const preferSmallMid = bool(p.general?.mids, true);
  const avoidBig = bool(p.general?.avoidBig, true);
  const near = bool(p.general?.near, true);

  // Size weights tuned for sensible defaults
  const sizeWeight = {
    micro: preferSmallMid ? 1.2 : 0.6,
    small: preferSmallMid ? 1.0 : 0.6,
    mid: preferSmallMid ? 0.6 : 0.8,
    large: avoidBig ? -1.2 : 0.2,
  };

  // Channel weights (light)
  const signalWeight = {
    local: near ? 1.6 : 0.2,
    ecommerce: bool(p.general?.ecom) ? 0.35 : 0.1,
    retail: bool(p.general?.retail) ? 0.35 : 0.1,
    wholesale: bool(p.general?.wholesale) ? 0.35 : 0.1,
  };

  // Core tags from products/sectors/targeting free text
  const baseAllow = [
    ...lowerClean(p.productTags),
    ...lowerClean(p.sectorHints),
    ...splitToLower(p.targeting?.sectors),
  ];

  // Richer concepts packed into prefixed tags (so they’re queryable later)
  const allowTags = [
    ...baseAllow,
    ...tag("title:", p.titlesPreferred),
    ...tag("mat:", p.materialsAllow),
    ...tag("cert:", p.certsRequired),
    ...tag("kw:", p.keywordsAdd),
  ];

  const blockTags = [
    ...tag("mat:", p.materialsBlock),
    ...tag("host:", p.excludeHosts),
    ...tag("kw:", p.keywordsAvoid),
  ];

  const patch = {
    city: (p.targeting?.city || "").trim() || undefined,
    radiusKm: clip(p.radiusKm, 1, 500, 50),
    preferSmallMid,
    sizeWeight,
    signalWeight,
    categoriesAllow: allowTags,
    categoriesBlock: blockTags,
    // tierFocus left to defaults unless you later expose it in UI
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
  return res.json({ ok: true, host, prefs, summary: prefsSummary(prefs) });
});

r.get("/:host", (req: Request, res: Response) => {
  const host = normHost(req.params.host);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });
  const prefs = getPrefs(host);
  return res.json({ ok: true, host, prefs, summary: prefsSummary(prefs) });
});

// POST /api/prefs/upsert
// Body = PanelPayload (see free-panel.html collectPersona())
r.post("/upsert", (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as PanelPayload;
    const host = normHost(body.host || body.line?.host || "");
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    // Clamp metric sliders 0..10 if present
    const metrics: SliderMetric[] = Array.isArray(body.metrics) ? body.metrics : [];
    for (const m of metrics) m.value = clip(m.value, 0, 10, 8);

    const patch = toPrefsPatch(body);
    const effective: EffectivePrefs = setPrefs(host, patch as any);

    return res.json({
      ok: true,
      host,
      prefs: effective,
      summary: prefsSummary(effective),
      accepted: {
        city: effective.city || null,
        radiusKm: effective.radiusKm,
        preferSmallMid: effective.preferSmallMid,
        sizeWeight: effective.sizeWeight,
        signalWeight: effective.signalWeight,
        categoriesAllow: effective.categoriesAllow.slice(0, 24),
        categoriesBlock: effective.categoriesBlock.slice(0, 24),
      },
    });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "prefs-upsert-failed", detail: msg });
  }
});

export default r;