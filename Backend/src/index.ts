import express from "express";
import cors from "cors";
import { leadsRouter } from "./routes/leads";

// Allow all by default; restrict via CORS_ORIGIN env (comma-separated)
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

// mount leads router
app.use("/api/v1", leadsRouter);

// tiny debug to list routes
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
