// src/routes/find.ts
//
// Robust "find buyers" route.
// - Accepts domain from many places: body.domain | body.supplierDomain | body.supplier | body.host | body.website | body.url | query.* | header x-supplier-domain
// - Normalizes to bare hostname (no scheme, no www).
// - CORS for browser calls (x-api-key + JSON).
// - Does not hard-fail if orchestrator is not present; returns a harmless empty result instead.

import type { Request, Response, NextFunction } from "express";
import express from "express";

const router = express.Router();

// ---- tiny utils -------------------------------------------------------------

function setCors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
}

function normalizeDomain(input?: string): string {
  if (!input) return "";
  let s = input.trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    let h = u.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    return "";
  }
}

function firstNonEmpty(...vals: Array<unknown>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length && typeof v[0] === "string") return v[0].trim();
  }
  return "";
}

// ---- optional orchestrator (don’t crash if absent) --------------------------

type Orchestrator =
  | {
      findBuyersForSupplier: (args: {
        domain: string;
        region?: string;
        radiusMi?: number;
        personaHint?: unknown;
        apiKey?: string | null;
      }) => Promise<{ created: number; hot: number; warm: number; candidates?: unknown[] }>;
    }
  | undefined;

let orchestrator: Orchestrator;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  orchestrator = require("../ai/orchestrator");
} catch {
  orchestrator = undefined;
}

// ---- route handlers ---------------------------------------------------------

router.options("/find-buyers", (req, res) => {
  setCors(res);
  return res.sendStatus(204);
});

router.post("/find-buyers", express.json(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    setCors(res);

    const tried: Record<string, string | undefined> = {
      "body.domain": req.body?.domain,
      "body.supplierDomain": req.body?.supplierDomain,
      "body.supplier": req.body?.supplier,
      "body.host": req.body?.host,
      "body.website": req.body?.website,
      "body.url": req.body?.url,
      "query.domain": req.query?.domain as string | undefined,
      "query.supplier": req.query?.supplier as string | undefined,
      "header.x-supplier-domain": (req.headers["x-supplier-domain"] as string | undefined) ?? undefined,
    };

    const raw =
      firstNonEmpty(
        tried["body.domain"],
        tried["body.supplierDomain"],
        tried["body.supplier"],
        tried["body.host"],
        tried["body.website"],
        tried["body.url"],
        tried["query.domain"],
        tried["query.supplier"],
        tried["header.x-supplier-domain"]
      ) || "";

    const domain = normalizeDomain(raw);

    if (!domain) {
      return res.status(400).json({
        ok: false,
        error: "domain is required",
        tried,
      });
    }

    const region =
      (typeof req.body?.region === "string" && req.body.region) ||
      (typeof req.query?.region === "string" && (req.query.region as string)) ||
      undefined;

    let radiusMi: number | undefined;
    const rBody = req.body?.radiusMi ?? req.body?.radius ?? req.query?.radiusMi ?? req.query?.radius;
    if (typeof rBody === "string" && rBody.trim()) radiusMi = Number(rBody);
    if (typeof rBody === "number") radiusMi = rBody;
    if (Number.isNaN(radiusMi as number)) radiusMi = undefined;

    const personaHint = req.body?.persona ?? req.body?.supplierPersona ?? undefined;
    const apiKey = (req.headers["x-api-key"] as string | undefined) ?? null;

    // Call orchestrator if present; otherwise return an OK empty result so the UI never sees a 400/500 here.
    let result = { created: 0, hot: 0, warm: 0, candidates: [] as unknown[] };

    if (orchestrator?.findBuyersForSupplier) {
      try {
        const r = await orchestrator.findBuyersForSupplier({
          domain,
          region,
          radiusMi,
          personaHint,
          apiKey,
        });
        result = { created: r.created ?? 0, hot: r.hot ?? 0, warm: r.warm ?? 0, candidates: r.candidates ?? [] };
      } catch (err) {
        // Don’t kill the request—surface a soft error and keep response shape stable.
        console.error("[find-buyers] orchestrator error:", err);
        result = { created: 0, hot: 0, warm: 0, candidates: [] };
      }
    }

    return res.status(200).json({
      ok: true,
      domain,
      region: region ?? null,
      radiusMi: radiusMi ?? null,
      ...result,
    });
  } catch (err) {
    return next(err);
  }
});

// Export a mount function so index.ts can `mountFind(app)`
export default function mountFind(app: import("express").Express) {
  app.use("/api/v1/leads", router);
  console.log("[routes] mounted find from ./routes/find");
}
