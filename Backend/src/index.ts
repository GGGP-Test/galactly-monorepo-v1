import express, { type Application } from "express";

// Health route exports a *named* function
import { registerHealth } from "./routes/health";

// Leads and Prefs currently export a *default* registrar
import registerLeads from "./routes/leads";
import registerPrefs from "./routes/prefs";

const app: Application = express();
app.use(express.json());

// Mount route registrars (do not pass extra args)
registerHealth(app);
registerLeads(app);
registerPrefs(app);

// Start server (Docker HEALTHCHECK probes http://127.0.0.1:${PORT}/healthz)
const PORT = Number(process.env.PORT) || 8787;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`buyers-api listening on ${PORT}`);
  });
}

export default app;