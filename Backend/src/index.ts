import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import { metricsMiddleware, metricsHandler } from "./metrics";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(metricsMiddleware); // record request + latency metrics

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));
app.get("/metrics", metricsHandler);

// Stub legacy list endpoint so the panel stops 404’ing when it probes it.
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = (req.query.temp === "hot" || req.query.temp === "warm") ? String(req.query.temp) : "warm";
  res.status(200).json({
    temp,
    region: req.query.region ?? null,
    warm: [],
    hot: []
  });
});

// Canonical route used by the Free Panel
app.post("/api/v1/leads/find-buyers", findBuyers);

// Accept both spellings + both verbs to be bulletproof
app.post("/find-buyers", findBuyers);
app.get("/api/v1/leads/find-buyers", findBuyers);
app.get("/find-buyers", findBuyers);

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const any = err as { status?: number; message?: string };
  const status = typeof any?.status === "number" ? any.status : 500;
  const message = any?.message ?? "Internal Server Error";
  res.status(status).json({ error: "INTERNAL_ERROR", message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`[server] listening on :${port}`));

export default app;