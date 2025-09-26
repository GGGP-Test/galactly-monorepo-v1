// src/index.ts
import express from "express";

import { registerHealth } from "./routes/health";
import { registerPrefs } from "./routes/prefs";
import { registerLeads } from "./routes/leads";

import { loadCatalog } from "./shared/catalog";
import { getPrefs, setPrefs } from "./shared/prefs";

async function main() {
  const app = express();

  // minimal, no external middleware yet (morgan/cors left out on purpose)
  app.use(express.json());

  // load catalog once at startup (implementation reads env/secret path)
  const catalog = await loadCatalog();

  // wire routes with their deps
  registerHealth(app, catalog);
  registerPrefs(app, { getPrefs, setPrefs });
  registerLeads(app, catalog, { getPrefs });

  const port = Number(process.env.PORT || 8787);
  app.listen(port, () => {
    console.log(`[buyers-api] listening on :${port}`);
  });
}

main().catch((err) => {
  console.error("[buyers-api] fatal during startup:", err);
  process.exit(1);
});