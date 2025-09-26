// src/routes/prefs.ts
//
// Minimal preferences API used by Free Panel.
// - GET  /api/prefs?host=peekpackaging.com     -> returns effective prefs + summary
// - POST /api/prefs                             -> upserts partial prefs for a host
//
// Notes:
// • Uses in-memory store from shared/prefs.ts (swappable later to Redis/DB).
// • Only whitelisted fields are applied; unknown keys are ignored safely.
//

import { Router, json } from "express";
import {
  getPrefs,
  setPrefs,
  defaultPrefs,
  normalizeHost,
  prefsSummary,
  type UserPrefs,
  type EffectivePrefs,
  type Tier,
  type SizeBucket,
} from "../shared/prefs";

// Narrow the body to allowed keys to keep things tidy/safe.
function pickPatch(input: any): Partial<UserPrefs> {
  const out: Partial<UserPrefs> = {};
  if (!input || typeof input !== "object") return out;

  if (input.host) out.host = String(input.host);
  if (input.city != null) out.city = String(input.city || "").trim() || undefined;

  // Keep radius reasonable; shared will clamp anyway.
  if (input.radiusKm != null) out.radiusKm = Number(input.radiusKm);

  if (typeof input.preferSmallMid === "boolean") out.preferSmallMid = input.preferSmallMid;

  // Size weights
  if (input.sizeWeight && typeof input.sizeWeight === "object") {
    out.sizeWeight = {};
    const sw = input.sizeWeight;
    if (sw.micro != null) out.sizeWeight!.micro = Number(sw.micro);
    if (sw.small != null) out.sizeWeight!.small = Number(sw.small);
    if (sw.mid != null) out.sizeWeight!.mid = Number(sw.mid);
    if (sw.large != null) out.sizeWeight!.large = Number(sw.large);
  }

  // Tier focus (A/B/C)
  if (Array.isArray(input.tierFocus)) {
    out.tierFocus = input.tierFocus
      .map((t: any) => String(t || "").toUpperCase())
      .filter((t: string) => t === "A" || t === "B" || t === "C") as Tier[];
  }

  // Categories allow/block
  if (Array.isArray(input.categoriesAllow)) {
    out.categoriesAllow = input.categoriesAllow.map((s: any) => String(s || ""));
  }
  if (Array.isArray(input.categoriesBlock)) {
    out.categoriesBlock = input.categoriesBlock.map((s: any) => String(s || ""));
  }

  // Signal weights
  if (input.signalWeight && typeof input.signalWeight === "object") {
    out.signalWeight = {};
    const sw = input.signalWeight;
    if (sw.local != null) out.signalWeight!.local = Number(sw.local);
    if (sw.ecommerce != null) out.signalWeight!.ecommerce = Number(sw.ecommerce);
    if (sw.retail != null) out.signalWeight!.retail = Number(sw.retail);
    if (sw.wholesale != null) out.signalWeight!.wholesale = Number(sw.wholesale);
  }

  // Per-click caps
  if (input.maxWarm != null) out.maxWarm = Number(input.maxWarm);
  if (input.maxHot != null) out.maxHot = Number(input.maxHot);

  return out;
}

export default function PrefsRouter(): Router {
  const r = Router();
  r.use(json());

  // GET /api/prefs?host=example.com
  r.get("/", (req, res) => {
    try {
      const hostQ = String(req.query.host || "");
      const host = normalizeHost(hostQ);
      if (!host) {
        return res.status(400).json({ ok: false, error: "Missing ?host" });
      }
      const prefs = getPrefs(host);
      return res.json({
        ok: true,
        prefs,
        summary: prefsSummary(prefs),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "prefs.get failed" });
    }
  });

  // POST /api/prefs
  // body: { host: string, ...partial UserPrefs fields... }
  r.post("/", (req, res) => {
    try {
      const body = req.body || {};
      const host = normalizeHost(body.host || body.supplierHost || "");
      if (!host) {
        return res.status(400).json({ ok: false, error: "Body must include { host }" });
      }
      const patch = pickPatch({ ...body, host });
      const saved = setPrefs(host, patch);
      return res.json({
        ok: true,
        prefs: saved,
        summary: prefsSummary(saved),
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || "prefs.post failed" });
    }
  });

  // Helpful default example (does not mutate store)
  r.get("/defaults", (req, res) => {
    const host = normalizeHost(String(req.query.host || "example.com"));
    const p = defaultPrefs(host);
    return res.json({ ok: true, prefs: p, summary: prefsSummary(p) });
  });

  return r;
}