import express, { Application } from "express";
import cors from "cors";
import morgan from "morgan";

export type App = Application;
export const app: App = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// Health checks (Northflank probes)
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
app.get("/api/healthz", (_req, res) => res.status(200).json({ ok: true }));

// Route mounts (names must exist in the route files below)
import { mountLeads } from "./routes/leads";
import { mountFind } from "./routes/find";
import { mountBuyers } from "./routes/buyers";
import { mountWebscout } from "./routes/webscout";

mountLeads(app);
mountFind(app);
mountBuyers(app);
mountWebscout(app);

// Boot only when executed directly (Northflank runs CMD; keep this)
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on :${PORT}`);
  });
}

// Named export to allow imports like: import type { App } from "../index";
export default app;
