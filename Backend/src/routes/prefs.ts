// src/routes/prefs.ts
//
// Preferences/Persona API used by step3.html and free-panel.html
//
// Endpoints:
//   GET  /api/prefs/ping
//   GET  /api/prefs/get?host=acme.com    -> persona-shaped view + raw prefs
//   GET  /api/prefs?host=acme.com        -> raw effective prefs (query form)
//   GET  /api/prefs/:host                -> raw effective prefs (param form)
//   POST /api/prefs/upsert               -> upsert from panel payload, returns effective prefs (ADMIN-ONLY)
//
// Notes
// - Stores data in the shared in-memory prefs store (no DB needed).
// - Maps panel payloads (Step 3 + Free Panel) to shared/prefs fields.
// - Unknown fields are ignored; inputs are clamped/sanitized.
// - Supports inboundOptIn (supplier opts in to inbound directory).

import { Router, Request, Response } from "express";
import {
  setPrefs,
  getPrefs,
  prefsSummary,
  normalizeHost as normHostShared,
  type EffectivePrefs,
} from "../shared/prefs";
import { requireAdmin } from "../shared/admin"; // <<< admin lock

const r = Router();

/* -------------------------------------------------------------------------- */
/* Types (panel payload)                                                      */
/* -------------------------------------------------------------------------- */

type SliderMetric = { label: string; value?: number };

type PanelPayload = {
  host?: string;

  // one-liner (not persisted here; kept for future)
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
    aiFinalize?: boolean; // Step 3 sends this; ignored by scorer but accepted
  };

  metrics?: SliderMetric[];

  targeting?: {
    // Step 3 + Free Panel
    city?: string;
    cities?: string[];
    titles?: string[];
    sector?: string;
    sectors?: string; // free text; split into tags
    revenueMinM?: number;
    revenueMaxM?: number;
    employees?: number;
  };

  inboundOptIn?: boolean;

  // Optional overlays (forwarded as-is if present)
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
      const s = String(v ?? "").trim().toLowerCase();
      if (s) set.add(s);
    }
  }
  return [...set];
}

function firstNonEmpty(arr?: unknown): string | undefined {
  if (!Array.isArray(arr)) return undefined;
  for (const v of arr) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return undefined;
}

/**
 * Map panel payload -> patch for shared/prefs.setPrefs()
 * We keep it simple and deterministic:
 * - preferSmallMid from general.mids
 * - sizeWeight.large down-weighted if general.avoidBig
 * - signalWeight.local boosted if general.near
 * - signalWeight.{ecommerce,retail,wholesale} nudged from toggles
 * - categoriesAllow from productTags + sectorHints + targeting.sectors (split)
 * - city from targeting.city OR first of targeting.cities
 * - titlesPreferred from targeting.titles (if present) OR explicit titlesPreferred
 * - inboundOptIn forwarded (default false)
 * - materials/certs/exclude/keywords forwarded if present
 */
function toPrefsPatch(p: PanelPayload) {
  const preferSmallMid = bool(p.general?.mids, true);
  const avoidBig = bool(p.general?.avoidBig, true);
  const near = bool(p.general?.near, true);

  const sizeWeight = {
    micro: preferSmallMid ? 1.2 : 0.6,
    small: preferSmallMid ? 1.0 : 0.6,
    mid:   preferSmallMid ? 0.6 : 0.8,
    large: avoidBig ? -1.2 : 0.2,
  };

  const signalWeight = {
    local: near ? 1.6 : 0.2,
    ecommerce: bool(p.general?.ecom) ? 0.35 : 0.1,
    retail:    bool(p.general?.retail) ? 0.35 : 0.1,
    wholesale: bool(p.general?.wholesale) ? 0.35 : 0.1,
  };

  const tags = uniqLower([
    ...(p.productTags || []),
    ...(p.sectorHints || []),
    ...String(p.targeting?.sectors || "")
      .split(/[;,]/)
      .map((s) => s.trim()),
  ]).slice(0, 32);

  const titlesPreferred =
    Array.isArray(p.targeting?.titles) && p.targeting!.titles!.length
      ? p.targeting!.titles
      : Array.isArray(p.titlesPreferred)
      ? p.titlesPreferred
      : undefined;

  const patch: Partial<EffectivePrefs> & Record<string, unknown> = {
    city: (p.targeting?.city || firstNonEmpty(p.targeting?.cities) || "").trim() || undefined,
    preferSmallMid,
    sizeWeight,
    signalWeight,
    categoriesAllow: tags,
    inboundOptIn: bool(p.inboundOptIn, false),

    // overlays (forward straight through if present)
    titlesPreferred,
    materialsAllow:  Array.isArray(p.materialsAllow)  ? p.materialsAllow  : undefined,
    materialsBlock:  Array.isArray(p.materialsBlock)  ? p.materialsBlock  : undefined,
    certsRequired:   Array.isArray(p.certsRequired)   ? p.certsRequired   : undefined,
    excludeHosts:    Array.isArray(p.excludeHosts)    ? p.excludeHosts    : undefined,
    keywordsAdd:     Array.isArray(p.keywordsAdd)     ? p.keywordsAdd     : undefined,
    keywordsAvoid:   Array.isArray(p.keywordsAvoid)   ? p.keywordsAvoid   : undefined,

    // tolerated-but-ignored knobs (persist nowhere, just accepted)
    __meta: {
      aiFinalize: bool(p.general?.aiFinalize, true),
      revenueMinM: clip(p.targeting?.revenueMinM, 0, 200, 0),
      revenueMaxM: clip(p.targeting?.revenueMaxM, 0, 200, 0),
      employees:   clip(p.targeting?.employees,   0, 5000, 0),
    },
  };

  return patch;
}

/** Build a persona-ish view from EffectivePrefs (for front-ends that expect it). */
function personaFromPrefs(host: string, prefs: EffectivePrefs) {
  const productTags = Array.isArray(prefs.categoriesAllow) ? prefs.categoriesAllow.slice(0, 12) : [];
  const general = {
    mids: !!prefs.preferSmallMid,
    avoidBig: (prefs.sizeWeight?.large ?? 0) < 0,
    near: (prefs.signalWeight?.local ?? 0) > 0.9,
    ecom: (prefs.signalWeight?.ecommerce ?? 0) > 0.2,
    retail: (prefs.signalWeight?.retail ?? 0) > 0.2,
    wholesale: (prefs.signalWeight?.wholesale ?? 0) > 0.2,
  };
  return {
    host,
    lineText: "",                 // optional; UI may edit and keep locally
    productTags,
    sectorHints: [],              // not tracked separately; UI can treat tags as both
    general,
    metrics: [],                  // UI will default if empty
    targeting: {
      city: prefs.city || "",
      cities: prefs.city ? [prefs.city] : [],
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

r.get("/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, at: new Date().toISOString() });
});

/** Persona-shaped GET used by free-panel.html */
r.get("/get", (req: Request, res: Response) => {
  const host = normHost(req.query.host as string);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });
  const prefs = getPrefs(host);
  const persona = personaFromPrefs(host, prefs);
  return res.json({
    ok: true,
    ...persona,
    prefs, // include raw effective prefs too
    inboundOptIn: prefs.inboundOptIn === true,
    summary: prefsSummary(prefs),
  });
});

// GET /api/prefs?host=acme.com
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

// GET /api/prefs/:host
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

// POST /api/prefs/upsert  (Body = PanelPayload)  — ADMIN-ONLY
r.post("/upsert", requireAdmin, (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as PanelPayload;
    const host = normHost(body.host || body.line?.host || "");
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    // optional: clamp metric values 0..10 (even if not stored)
    const metrics: SliderMetric[] = Array.isArray(body.metrics) ? body.metrics : [];
    for (const m of metrics) m.value = clip(m.value, 0, 10, 8);

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
        categoriesAllow: (effective.categoriesAllow || []).slice(0, 12),
        preferSmallMid: !!effective.preferSmallMid,
        sizeWeight: effective.sizeWeight,
        signalWeight: effective.signalWeight,
        titlesPreferred: (effective as any)["titlesPreferred"] || [],
        inboundOptIn: effective.inboundOptIn === true,
      },
    });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res
      .status(200)
      .json({ ok: false, error: "prefs-upsert-failed", detail: msg });
  }
});

export default r;