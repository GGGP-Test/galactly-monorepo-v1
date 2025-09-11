// src/routes/find.ts
import type { App } from "../index";

export function mountFind(app: App) {
  // Canonical endpoint
  app.post("/api/v1/find", async (req, res) => {
    const { domain, region = "us", radiusMi = 50, keywords = "" } = req.body || {};
    if (!domain) return res.status(400).json({ ok: false, error: "domain is required" });

    // Pipeline stub: enqueue or call webscout + rankers here
    const started = Date.now();
    // Return immediately; UI will refresh lists via /api/v1/leads
    return res.status(202).json({ ok: true, started, domain, region, radiusMi, keywords });
  });

  // Backwards compat alias
  app.post("/api/v1/find-now", (req, res) => {
    (req as any).url = "/api/v1/find";
    (app as any)._router.handle(req, res, () => {});
  });
}

export default mountFind;
