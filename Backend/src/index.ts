// src/index.ts
import express, { type Application } from "express";
import cors from "cors";

import { registerHealth } from "./routes/health"; // named export
import registerLeads from "./routes/leads";      // default export in module
import registerPrefs from "./routes/prefs";      // default export in module

const app: Application = express();

// minimal, dependency-free middleware (we intentionally skipped morgan for now)
app.disable("x-powered-by");
app.use(cors());
app.use(express.json());

// wire routes via their register functions
registerHealth(app);
registerLeads(app);
registerPrefs(app);

// start server (Docker runs node dist/index.js)
const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[buyers-api] listening on :${port}`);
  }
});

export default app;