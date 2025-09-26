// src/index.ts
import express, { Application } from "express";
import { registerHealth } from "./routes/health";
import { registerLeads } from "./routes/leads";
import { registerPrefs } from "./routes/prefs";

export function createServer(): Application {
  const app = express();            // <-- no args (TS2554 fixer)
  app.use(express.json());

  // Each register* takes (app, base?) and returns void
  registerHealth(app);
  registerLeads(app);
  registerPrefs(app);

  return app;
}

if (require.main === module) {
  const app = createServer();
  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => {
    console.log(`[buyers-api] listening on :${port}`);
  });
}