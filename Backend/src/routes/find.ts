import type { Express } from "express";
import { Router } from "express";
import { inferPersonaAndTargets } from "../ai/webscout";

export const mountFind = (app: Express) => {
  const r = Router();

  r.post("/find", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const supplierDomain =
      body.supplierDomain || body.domain || (req.query.domain as string);

    if (!supplierDomain || typeof supplierDomain !== "string") {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    const data = await inferPersonaAndTargets(supplierDomain);
    return res.json({ ok: true, supplierDomain, ...data });
  });

  app.use("/api/v1/leads", r);
};

export default mountFind;
