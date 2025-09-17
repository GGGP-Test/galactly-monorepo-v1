// Backend/src/server.route.public.ts
import { Router, Request, Response, NextFunction } from "express";

const r = Router();

// Small helper to keep handlers tidy
const safe =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

// Health (kept here too so mounting path is flexible)
r.get("/healthz", (_req, res) => res.status(200).send("OK"));

/**
 * GET /api/v1/persona?url=https://example.com
 * Delegates to ./persona module (whatever shape it exposes).
 */
r.get(
  "/api/v1/persona",
  safe(async (req, res) => {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ ok: false, error: "url is required" });

    // Try a few likely export names to be resilient
    const mod = await import("./persona");
    const fn =
      (mod as any).inferPersona ||
      (mod as any).persona ||
      (mod as any).getPersona ||
      (mod as any).default;

    if (typeof fn !== "function") {
      return res.status(500).json({ ok: false, error: "persona module not callable" });
    }

    const data = await fn(url);
    res.json(data);
  })
);

/**
 * GET /api/v1/leads?temp=warm&region=usca
 * Reads from buyers store (if present) or returns empty list.
 */
r.get(
  "/api/v1/leads",
  safe(async (req, res) => {
    const temp = String(req.query.temp || "warm");
    const region = String(req.query.region || "");

    let items: any[] = [];
    // Try a few likely store modules/signatures
    let store: any = null;

    try {
      store = await import("./buyers/store");
    } catch {}
    if (!store) {
      try {
        store = await import("./store");
      } catch {}
    }

    if (store) {
      const listFn =
        store.list ||
        store.getLeads ||
        store.query ||
        store.default;

      if (typeof listFn === "function") {
        try {
          const result = await listFn({ temp, region });
          // normalize to array
          items = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : [];
        } catch {
          items = [];
        }
      }
    }

    res.json({ ok: true, items });
  })
);

/**
 * POST /api/v1/leads/find-buyers
 * Body: { supplier, region, radiusMi, persona, onlyUSCA }
 * Delegates to ./buyers/discovery module.
 */
r.post(
  "/api/v1/leads/find-buyers",
  safe(async (req, res) => {
    const body = req.body || {};
    if (!body?.supplier) {
      return res.status(400).json({ ok: false, error: "supplier is required" });
    }

    const mod = await import("./buyers/discovery");
    const fn =
      (mod as any).findBuyers ||
      (mod as any).discover ||
      (mod as any).run ||
      (mod as any).default;

    if (typeof fn !== "function") {
      return res.status(500).json({ ok: false, error: "discovery module not callable" });
    }

    const result = await fn(body);
    // Expecting { created, candidates } but we’ll passthrough whatever it returns
    res.json({ ok: true, ...result });
  })
);

export default r;
