import type { App } from "../index";

// Simple echo endpoint for now; Free Panel may call this directly later.
export function mountBuyers(app: App) {
  app.post("/api/v1/buyers/test", (req, res) => {
    res.json({ ok: true, received: req.body || {} });
  });
}
