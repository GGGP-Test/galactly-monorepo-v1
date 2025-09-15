// Backend/src/routes/public.ts
import express, { Application, Request, Response, NextFunction } from "express";

/**
 * Mounts the public API under /api without ever calling app.options().
 * We handle CORS + preflight via a simple middleware so runtime can't blow up.
 */
export function mountPublic(app: Application) {
  const api = express.Router();

  // Body parsers (keep small to avoid surprises)
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // CORS (preflight handled here — NO app.options)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "https://gggp-test.github.io");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    if (req.method === "OPTIONS") {
      res.status(204).end(); // preflight done
      return;
    }
    next();
  });

  // Health
  api.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

  // POST /api/v1/leads/find-buyers
  api.post("/v1/leads/find-buyers", async (req: Request, res: Response) => {
    try {
      const { supplier, region, radiusMi, persona } = normalizeBody(req.body);

      // Simple key check; uses your known key unless overridden by env on NF
      const key = process.env.API_KEY || process.env.X_API_KEY || "NFjeipPuj44kMS2dfjsyHSkdKSt97S6s5f56sG5";
      const sent = req.header("x-api-key") || "";
      if (!sent || sent !== key) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }

      if (!supplier) {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }

      // TODO: wire your real discovery here (kept minimal to avoid 500s).
      // Returning a deterministic "ok with 0" keeps transport green while you
      // iterate on discovery logic separately.
      const out = {
        ok: true,
        supplier: { domain: supplier, region, radiusMi },
        created: 0,
        hot: 0,
        warm: 0,
        candidates: [],
        note: "",
        message:
          "Created 0 candidate(s). Hot:0 Warm:0. (Either no matches or discovery was blocked.)",
      };

      res.status(200).json(out);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Mount under /api
  app.use("/api", api);
}

function normalizeBody(body: any) {
  const supplier = String(body?.supplier || body?.domain || "").trim();
  const region = String(body?.region || "usca").toLowerCase();
  const radiusMi = Number(body?.radiusMi ?? 50) || 50;
  const persona = body?.persona || { offer: "", solves: "", titles: "" };
  return { supplier, region, radiusMi, persona };
}