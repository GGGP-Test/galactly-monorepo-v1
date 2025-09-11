// src/routes/buyers.ts
import type { App } from "../index";

export function mountBuyers(app: App) {
  // Minimal placeholder so imports compile cleanly
  app.get("/api/v1/buyers/ping", (_req, res) => res.json({ ok: true }));
}

export default mountBuyers;
