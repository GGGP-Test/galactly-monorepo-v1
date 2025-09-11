import type { App } from "../index";
import { inferPersonaAndTargets } from "../ai/webscout";

export function mountWebscout(app: App) {
  // POST /api/v1/webscout/infer { supplierDomain, region? }
  app.post("/api/v1/webscout/infer", async (req, res) => {
    const supplierDomain = String(req.body.supplierDomain || "").trim();
    if (!supplierDomain) return res.status(400).json({ ok: false, error: "supplierDomain required" });

    try {
      const persona = await inferPersonaAndTargets(supplierDomain, req.body.region);
      res.json({ ok: true, persona });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "infer failed" });
    }
  });
}
