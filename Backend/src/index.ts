import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import metrics from "./services/metrics"; // NEW

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// Legacy list stub so the panel never 404s
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({
    ok: true,
    temp,
    region: req.query.region ?? null,
    items: [], // saved is client-side for Free Panel; this endpoint remains for compatibility
  });
});

// --- Find buyers endpoints (with rate limit) ---
const rl = rateLimit({ windowMs: 10_000, max: 4 }); // 4 tries / 10s as agreed

// canonical route used by the Free Panel
app.post("/api/v1/leads/find-buyers", rl, findBuyers);

// extra aliases to be bulletproof
app.post("/find-buyers", rl, findBuyers);
app.get("/api/v1/leads/find-buyers", rl, findBuyers);
app.get("/find-buyers", rl, findBuyers);

// --- NEW: Metrics / FOMO counters / Deepen stubs ---
app.use(metrics);

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

// error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const any = err as { status?: number; message?: string };
  const status = typeof any?.status === "number" ? any.status : 500;
  const message = any?.message ?? "Internal Server Error";
  res.status(status).json({ error: "INTERNAL_ERROR", message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`[server] listening on :${port}`));

export default app;