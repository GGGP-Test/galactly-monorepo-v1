// src/index.ts
import express, { Application } from "express";

// Named registrar
import { registerHealth } from "./routes/health";

// Routers
import { LeadsRouter } from "./routes/leads";
import { PrefsRouter } from "./routes/prefs";

// NOTE: catalog route is pinned for later re-enable to keep builds green
// import registerCatalog from "./routes/catalog";

const app: Application = express();

// Core middleware
app.use(express.json());

// Health endpoint(s)
registerHealth(app);

// Feature routers
app.use("/leads", LeadsRouter);
app.use("/prefs", PrefsRouter);

// Pinned: re-enable when ready
// registerCatalog(app);

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`buyers-api listening on :${PORT}`);
});

export default app;