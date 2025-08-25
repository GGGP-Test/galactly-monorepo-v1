import express from "express";
import cors from "cors";
import { leadsRouter } from "./routes/leads";
import { requireAuth } from "./auth";
import { beat, countActive, displayedCount } from "./presence";
import gateRouter from "./routes/gate";
import aiRouter from './routes/ai';


function makeCors() {
  const list = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return cors({ origin: (_o, cb) => cb(null, true), credentials: true });
  return cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = list.some((o) => origin === o);
      cb(ok ? null : new Error("CORS"), ok);
    },
    credentials: true
  });
}

const app = express();
app.use(express.json());
app.use(makeCors());

// health + status
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/v1/status", (_req, res) => res.json({ status: "ok" }));

// onboarding (AUTO_VERIFY_EMAIL=1 returns session immediately)
app.use("/api/v1", gateRouter);

// presence
app.post("/api/v1/presence/beat", requireAuth, (req, res) => {
  const email = (req as any).userEmail as string;
  beat(email);
  res.json({ ok: true });
});
app.get("/api/v1/presence/online", (_req, res) => {
  const real = countActive();
  res.json({ ok: true, real, displayed: displayedCount(real) });
});

// leads
app.use("/api/v1", leadsRouter);
app.use('/api/v1/ai', aiRouter);
// tiny debug route
app.get("/__routes", (_req, res) => {
  const anyApp: any = app;
  const routes =
    (anyApp._router?.stack || [])
      .filter((r: any) => r.route)
      .map((r: any) => ({
        path: r.route?.path,
        methods: Object.keys(r.route?.methods || {})
      })) || [];
  res.json(routes);
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log("API up on", port));
