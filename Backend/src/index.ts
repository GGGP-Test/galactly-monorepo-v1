// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import { quota, snapshotQuota, resetQuota, setPlanForApiKey } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health",  (_req: Request, res: Response) => res.status(200).json({ ok: true }));

/**
 * Legacy list stub so the Free Panel never 404s.
 * We return empty arrays – demo UI only needs shape + 200.
 */
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = (req.query.temp === "hot" || req.query.temp === "warm") ? String(req.query.temp) : "warm";
  res.status(200).json({ temp, region: req.query.region ?? null, warm: [], hot: [] });
});

/** --- Controls for local/dev testing (safe no-ops in prod) --- */
if (process.env.TEST_API_KEY) {
  // Put the TEST_API_KEY on "test" plan automatically (effectively unbounded for you)
  setPlanForApiKey(process.env.TEST_API_KEY, "test");
}

app.get("/metrics", (_req: Request, res: Response) => {
  const snap = snapshotQuota();
  res.status(200).json({ ok: true, findBuyers: snap });
});

app.post("/__admin/quota/reset", (_req: Request, res: Response) => {
  resetQuota();
  res.status(200).json({ ok: true });
});

/** --- Request shaping: burst rate-limit + daily quota --- */
const rl = rateLimit({ windowMs: 10_000, max: 4 }); // 4 tries / 10s (what you validated)
const qd = quota(); // uses env defaults (FREE=3/day) + TEST_API_KEY bypass

/** Canonical route used by the Free Panel */
app.post("/api/v1/leads/find-buyers", rl, qd, findBuyers);

/** Accept aliases (helps when wiring different panels/links) */
app.post("/find-buyers", rl, qd, findBuyers);
app.get("/api/v1/leads/find-buyers", rl, qd, findBuyers);
app.get("/find-buyers", rl, qd, findBuyers);

/** 404 */
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

/** Error handler */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const any = err as { status?: number; message?: string };
  const status = typeof any?.status === "number" ? any.status : 500;
  const message = any?.message ?? "Internal Server Error";
  res.status(status).json({ error: "INTERNAL_ERROR", message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`[server] listening on :${port}`));

export default app;