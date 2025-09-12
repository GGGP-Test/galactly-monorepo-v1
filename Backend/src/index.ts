import express, { type Application } from "express";
import { mountFind } from "./routes/find";
import { mountBuyers } from "./routes/buyers";
import mountWebscout from "./routes/webscout";

export type App = Application;

export function createApp(): Application {
  const app = express();
  app.use(express.json());

  // Mount minimal routes
  mountFind(app);
  mountBuyers(app);
  mountWebscout(app);

  // Simple health endpoint for sanity
  app.get("/health", (_req, res) => res.json({ ok: true }));

  return app;
}

// Allow running as a standalone server (optional)
if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`Server listening on ${port}`);
  });
}
