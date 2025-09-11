// src/routes/webscout.ts
import type { App } from "../index";
import { inferPersonaAndTargets } from "../ai/webscout";

export function mountWebscout(app: App) {
  // POST /api/v1/webscout/scan  body: { domain, region?, radiusMi? }
  app.post("/api/v1/webscout/scan", async (req, res) => {
    const { domain, region = "us", radiusMi = 50 } = req.body || {};
    if (!domain) return res.status(400).json({ ok: false, error: "domain is required" });
    try {
      const persona = await inferPersonaAndTargets(domain);
      return res.json({ ok: true, domain, region, radiusMi, persona });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
}

export default mountWebscout;
