// src/index.ts
import express, { Application } from "express";

// Route mount points — match each module’s export style
import mountWebscout from "./routes/webscout";   // default export
import { mountFind } from "./routes/find";       // named export
import { mountBuyers } from "./routes/buyers";   // named export

const app: Application = express();
app.use(express.json());

// Each mount function should accept only the app (no extra args)
mountWebscout(app);
mountFind(app);
mountBuyers(app);

// Simple health probe (optional but harmless)
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Expose both a default export and a named `App` so imports like
//   import App from "../../index"
// and
//   import { App } from "../../index"
// both succeed.
export { app as App };
export type { Application as AppType };
export default app;
