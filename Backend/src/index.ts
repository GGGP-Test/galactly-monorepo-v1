// src/index.ts
import express, { Application } from "express";
import type { Request, Response } from "express";

// ---- create app ----
const app = express();
app.use(express.json());

// ---- health/ping ----
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// ---- mount routes (named exports expected) ----
// These imports match your code that uses named mounts.
try {
  // If these modules exist, they’ll be mounted; if not, the app still compiles.
  // Keep them commented or remove if you don’t want them yet.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const buyers = require("./routes/buyers");
  if (buyers?.mountBuyers) buyers.mountBuyers(app);
} catch {}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const find = require("./routes/find");
  if (find?.mountFind) find.mountFind(app);
} catch {}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const webscout = require("./routes/webscout");
  if (webscout?.mountWebscout) webscout.mountWebscout(app);
} catch {}

// ---- exports ----
// Type-only name for your routes’ type imports:
export type App = Application;

// Default export for runtime usage:
export default app;

// Also export a value named App in case any code imports it as a value.
// (Type/value merging lets both “type App” and value “App” coexist.)
export { app as App };
