import type { Express } from "express";
import { Router } from "express";
import {
  inferPersonaAndTargets,
  scoreAndLabelCandidates
} from "../ai/webscout";

export const mountWebscout = (app: Express) => {
  const r = Router();

  // POST /api/v1/leads/find-buyers  (Free Panel V2 uses this)
  r.post("/find-buyers", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, any>;

    const supplierDomain =
      body.supplierDomain || body.domain || (req.query.domain as string);

    if (!supplierDomain || typeof supplierDomain !== "string") {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    const region = (body.region ?? body.geo ?? "US/CA")
      .toString()
      .trim()
      .toUpperCase();
    const radiusMi = Number(body.radiusMi ?? body.radius ?? 50);

    const personaTargets = await inferPersonaAndTargets(supplierDomain);
    const candidates = await scoreAndLabelCandidates(supplierDomain, {
      region,
      radiusMi
    });

    return res.json({
      ok: true,
      supplierDomain,
      region,
      radiusMi,
      ...personaTargets,
      candidates
    });
  });

  app.use("/api/v1/leads", r);
};

export default mountWebscout;
