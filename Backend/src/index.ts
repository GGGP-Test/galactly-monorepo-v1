import express from "express";
import cors from "cors";

import { mountPublic } from "./routes/public";
import { mountLeads } from "./routes/leads";
import { mountAdmin } from "./routes/admin";   // ⬅ new

const app = express();

// core middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.disable("x-powered-by");

// minimal security headers for JSON APIs (the /admin route overrides CSP itself)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Default CSP: safest for API JSON. The /admin page will override to allow inline script.
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  next();
});

// health
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// mount routes
mountPublic(app);
mountLeads(app);
mountAdmin(app); // ⬅ serve the operator console at /admin

// start if run directly (in Northflank we run the compiled JS)
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on :${port}`);
  });
}

export default app;
