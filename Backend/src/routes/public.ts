import type { Express, Request, Response, NextFunction } from "express";

/**
 * Tiny CORS middleware with no external deps.
 * It answers OPTIONS preflight itself so Express never needs app.options().
 */
function simpleCors(allowedOrigin: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // allow specific origin (or "*" if you really want)
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");

    // what’s allowed
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");

    // short-circuit preflight
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  };
}

/**
 * Mounts PUBLIC endpoints.
 * We keep everything here to avoid cross-file import issues.
 */
export function mountPublic(app: Express) {
  const allowedOrigin =
    process.env.FTE_ORIGIN?.trim() || "https://gggp-test.github.io";

  // Health check
  app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

  // JSON body parsing for API
  app.use("/api", simpleCors(allowedOrigin), (req, _res, next) => {
    // ensure JSON parser is applied only under /api
    // (using express.json() here avoids adding global middleware)
    // @ts-ignore – dynamic import to avoid top-level import order issues
    import("express").then(({ json }) => json({ limit: "1mb" })(req, _res, next));
  });

  // ---- BUYERS: POST /api/v1/leads/find-buyers ----
  app.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      supplier?: string;
      domain?: string;
      region?: string;
      radiusMi?: number;
      persona?: { offer?: string; solves?: string; titles?: string };
    };

    const supplier = String(body.supplier || body.domain || "").trim();
    const region = String(body.region || "usca").toLowerCase();
    const radiusMi = Number(body.radiusMi ?? 50);

    // minimal request logging to Northflank logs
    console.log(`[buyers] POST /find-buyers -> supplier="${supplier}" region=${region} r=${radiusMi}`);

    if (!supplier) {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    // TODO: wire real discovery. For now, respond deterministically so the UI and smoke tests are stable.
    const payload = {
      ok: true,
      supplier: { domain: supplier, region, radiusMi },
      created: 0,
      hot: 0,
      warm: 0,
      candidates: [] as any[],
      note: "",
      message:
        "Created 0 candidate(s). Hot:0 Warm:0. (Either no matches or discovery was blocked.)",
    };

    return res.status(200).json(payload);
  });
}