import type { Express } from "express";
import { Router } from "express";
import {
  inferPersonaAndTargets,
  scoreAndLabelCandidates,
} from "../ai/webscout";

export default function mountWebscout(app: Express) {
  const r = Router();

  // POST /api/v1/leads/find-buyers
  r.post("/find-buyers", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, any>;

    // accept either `supplierDomain` (from the panel) or `domain` (older clients)
    const supplierDomain =
      body.supplierDomain || body.domain || (req.query.domain as string);

    if (!supplierDomain || typeof supplierDomain !== "string") {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    const region =
      (body.region ?? body.geo ?? "US/CA").toString().trim().toUpperCase(); // US, CA, or US/CA
    const radiusMi = Number(body.radiusMi ?? body.radius ?? 50);

    // persona (human-editable summary block)
    const persona = await inferPersonaAndTargets(supplierDomain);

    // candidates (leads list)
    const candidates = await scoreAndLabelCandidates(supplierDomain, {
      region,
      radiusMi,
    });

    return res.json({
      ok: true,
      supplierDomain,
      region,
      radiusMi,
      created: Date.now(),
      ids: [],
      persona,
      candidates,
      errors: 0,
    });
  });

  app.use("/api/v1/leads", r);
}
