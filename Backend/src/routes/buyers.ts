import type { Express } from "express";
import { Router } from "express";
import { scoreAndLabelCandidates } from "../ai/webscout";

export const mountBuyers = (app: Express) => {
  const r = Router();

  r.post("/buyers", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const supplierDomain =
      body.supplierDomain || body.domain || (req.query.domain as string);

    if (!supplierDomain || typeof supplierDomain !== "string") {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    const region = (body.region ?? "US/CA").toString().toUpperCase();
    const radiusMi = Number(body.radiusMi ?? body.radius ?? 50);

    const candidates = await scoreAndLabelCandidates(supplierDomain, {
      region,
      radiusMi
    });

    return res.json({
      ok: true,
      supplierDomain,
      region,
      radiusMi,
      candidates
    });
  });

  app.use("/api/v1/leads", r);
};

export default mountBuyers;
