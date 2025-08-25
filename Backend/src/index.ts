import express from "express";
import cors from "cors";
import { leadsRouter } from "./routes/leads";

// --- CORS: allow all by default; restrict via CORS_ORIGIN env (comma-sep) ---
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

// --- health + status ---
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/v1/status", (_req, res) => res.json({ status: "ok" }));

// --- simple presence (no DB) ---
const seen = new Map<string, number>();
function now() { return Date.now(); }
setInterval(() => {
  const n = now();
  for (const [k, v] of seen) if (n - v > 2 * 60_000) seen.delete(k);
}, 30_000);

function humansOnlineValue(): { real: number; displayed: number } {
  const real = [...seen.values()].filter(ts => now() - ts < 120_000).length;
  // Never look empty: floor at ~30, add a tiny pad
  const floor = 30;
  const pad = Math.min(7, Math.round(real * 0.1));
  const displayed = Math.max(real, floor) + pad;
  return { real, displayed };
}

app.post("/api/v1/presence/beat", (req, res) => {
  const uid =
    (req.headers["x-galactly-user"] as string) ||
    (req.query.userId as string) ||
    "anon-" + (req.ip || "");
  seen.set(uid, now());
  res.json({ ok: true });
});

app.get("/api/v1/presence/online", (_req, res) => {
  const { real, displayed } = humansOnlineValue();
  res.json({ real, displayed });
});

// --- mount leads router (adds /api/v1/peek and /api/v1/leads) ---
app.use("/api/v1", leadsRouter);

// --- tiny debug to list routes ---
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
