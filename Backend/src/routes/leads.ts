import { Router, Request, Response } from "express";

export const leadsRouter = Router();

type FindBuyersParams = {
  host: string;
  country?: string;
  radius?: number;
};

function parseParams(req: Request): FindBuyersParams {
  const q = req.query ?? {};
  const b: any = (req as any).body ?? {};

  const host =
    (q.host ?? b.host ?? "").toString().trim().toLowerCase();

  const country = (q.country ?? b.country ?? "").toString();
  const radiusRaw = q.radius ?? b.radius;
  const radius =
    radiusRaw === undefined || radiusRaw === null
      ? undefined
      : Number(radiusRaw);

  return { host, country, radius };
}

/**
 * Simple health check so you (and CI) can verify the router is mounted.
 * GET /api/v1/leads/healthz -> { ok: true, service: "leads" }
 */
leadsRouter.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "leads" });
});

/**
 * Canonical endpoint the free panel will call.
 * Accepts GET (query) and POST (json body) with:
 *   host (required), country (optional), radius (optional)
 * Returns { ok: true, items: [] } for now so wiring is verified with 200.
 * We'll plug in the real selection logic next.
 */
function handleFindBuyers(req: Request, res: Response) {
  const p = parseParams(req);
  if (!p.host) {
    return res.status(400).json({ ok: false, error: "host required" });
  }

  // TODO: Replace this stub with your real logic that returns one (or more)
  // leads for the given supplier host. Keep the response shape:
  // { ok: true, items: Array<{ host, platform, title, created, temp, why }> }
  const items: Array<Record<string, unknown>> = [];

  return res.json({ ok: true, items });
}

leadsRouter.get("/find-buyers", handleFindBuyers);
leadsRouter.post("/find-buyers", handleFindBuyers);