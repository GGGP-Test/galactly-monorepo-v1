/**
 * Galactly API – single entry
 * Fixes: health probe 404, 500 /find-now, consistent /api/v1 prefix, CORS.
 */
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import morgan from "morgan";
import leads from "./routes/leads";

const app = express();

// ---------- basic middleware ----------
app.disable("x-powered-by");
app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------- CORS (allow GH pages + localhost + code.run) ----------
const ALLOW = [
  /\.github\.io$/,
  /localhost:\d+$/,
  /127\.0\.0\.1:\d+$/,
  /\.code\.run$/,
];
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      const ok = ALLOW.some((re) => re.test(origin));
      cb(null, ok);
    },
    credentials: false,
  })
);

// ---------- health & root ----------
app.get("/", (_req, res) => res.status(200).json({ ok: true, service: "galactly" }));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ---------- API v1 ----------
const v1 = express.Router();

// status (lightweight – no DB dependency)
v1.get("/status", (req: Request, res: Response) => {
  const uid = (req.header("x-galactly-user") || "").trim() || `u-${Math.random().toString(16).slice(2)}`;
  const devUnlimited = String(process.env.GAL_DEV_UNLIMITED || process.env.DEV_UNLIMITED || "") === "true";
  res.json({
    ok: true,
    uid,
    plan: "free",
    quota: {
      date: new Date().toISOString().slice(0, 10),
      findsUsed: 0,
      revealsUsed: 0,
      findsLeft: devUnlimited ? 999999 : 100,
      revealsLeft: devUnlimited ? 999999 : 5,
    },
    devUnlimited,
  });
});

// leads/endpoints
v1.use(leads);

// mount
app.use("/api/v1", v1);

// ---------- 404 + error handler ----------
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found", path: req.originalUrl }));

// never leak stack
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api-error]", err?.message || err);
  res.status(200).json({ ok: false, error: "temporary_unavailable" });
});

// ---------- start ----------
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});

export default app;
