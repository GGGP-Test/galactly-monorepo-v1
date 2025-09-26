import express from "express";
import type { Application } from "express";

import { registerHealth } from "./routes/health";
import { registerLeads } from "./routes/leads";
import { registerPrefs } from "./routes/prefs";

const app: Application = express();

// basic middleware only (keep deps minimal for now)
app.use(express.json());

// mount routes via register-helpers
registerHealth(app); // exposes GET /healthz
registerLeads(app);
registerPrefs(app);

// simple root for sanity
app.get("/", (_req, res) => res.json({ ok: true }));

// start server
const port = Number(process.env.PORT) || 8787;
app.listen(port);

export default app;