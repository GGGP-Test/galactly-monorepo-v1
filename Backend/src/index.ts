// backend/src/index.ts
import express, { Application, json, urlencoded } from "express";
import cors from "cors";

// Use local shim instead of external "morgan" package to avoid runtime dep.
import morgan from "./shims/morgan";

// Export a named App type so routes can `import { App } from "../index"`
export type App = Application;

export function createApp(): App {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(json({ limit: "1mb" }));
  app.use(urlencoded({ extended: true }));
  app.use(morgan("tiny"));

  // Health
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  return app;
}

// Optional default app (some callers expect it)
const app = createApp();
export default app;
