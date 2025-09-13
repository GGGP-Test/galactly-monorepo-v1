// src/routes/buyers.ts
import { Router, Request, Response } from "express";

const router = Router();

// CORS preflight (belt & suspenders – top-level may already handle it)
router.options("/leads/find-buyers", (_req, res) => res.sendStatus(204));

function pick<T = string>(obj: any, keys: string[], map?: (v: any) => T): T | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return map ? map(v) : (v as T);
    }
  }
  return undefined;
}

function normalizeDomain(input?: string) {
  if (!input) return "";
  return String(input)
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

router.post("/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    // Accept many historical/alias field names
    const domainRaw =
      pick<string>(body, ["domain", "host", "supplier", "website", "url", "text"]) ??
      (typeof req.query.domain === "string" ? req.query.domain : undefined);

    const domain = normalizeDomain(domainRaw);

    const region =
      pick<string>(body, ["region", "country", "geo"], (v) => String(v).trim()) ??
      (typeof req.query.region === "string" ? req.query.region : undefined);

    const radiusMi =
      Number(
        pick<number>(body, ["radiusMi", "radius", "miles"], (v) => Number(v)) ??
          (typeof req.query.radius === "string" ? Number(req.query.radius) : NaN)
      ) || 50;

    if (!domain) {
      // Help future debugging by echoing what we received (keys only)
      const keys = Object.keys(body ?? {});
      return res
        .status(400)
        .json({ ok: false, error: "domain is required", receivedKeys: keys });
    }

    // TODO: plug real discovery here (buyer-discovery.ts).
    const result = {
      ok: true,
      supplier: { domain, region, radiusMi },
      created: 0,
      hot: 0,
      warm: 0,
      candidates: [] as Array<any>,
      message: "Created 0 candidate(s). Hot:0 Warm:0. Refresh lists to view.",
    };
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[buyers] find-buyers error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "internal_error" });
  }
});

// quick sanity ping
router.get("/leads/_buyers-ping", (_req, res) => res.json({ ok: true, where: "buyers" }));

export default router;