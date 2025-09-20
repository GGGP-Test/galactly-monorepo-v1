import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";

// Allow GET-based testing by mapping query -> the body the service expects
function findBuyersFromQuery(req: Request, res: Response, next: NextFunction) {
  const q = req.query as Record<string, any>;
  (req as any).body = {
    supplier: q.supplier ?? "",
    region: (q.region as string) ?? "usca",
    radiusMi: q.radiusMi ? Number(q.radiusMi) : 50,
    onlyUSCA: q.onlyUSCA !== "false",
    persona: {
      offer: (q.offer as string) ?? "",
      solves: (q.solves as string) ?? "",
      titles: (q.titles as string) ?? "",
    },
  };
  return (findBuyers as any)(req, res, next);
}

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// Stub the list endpoint the panel pings for Hot/Warm to avoid 404s
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" ? "hot" : "warm";
  const region = typeof req.query.region === "string" ? req.query.region : null;
  res.status(200).json({
    ok: true,
    temp,
    region,
    // include multiple shapes so the UI is happy regardless of reader
    items: [],
    warm: [],
    hot: [],
  });
});

// Canonical route used by the Free Panel button
app.post("/api/v1/leads/find-buyers", findBuyers);

// Convenience aliases (both verbs + short path)
app.post("/find-buyers", findBuyers);
app.get("/api/v1/leads/find-buyers", findBuyersFromQuery);
app.get("/find-buyers", findBuyersFromQuery);

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