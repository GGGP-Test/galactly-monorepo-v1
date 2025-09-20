import express, { Request, Response, NextFunction, RequestHandler } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";

const app = express();

// CORS for the GitHub panel (different origin)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "1mb" }));

// Health
app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// ---- Find Buyers ----
// Canonical POST route you already had (keep it)
app.post("/api/v1/leads/find-buyers", findBuyers);

// Also accept POST at these simpler paths (panel variants)
app.post("/find-buyers", findBuyers);
app.post("/api/v1/find-buyers", findBuyers);

// GET shim: map query params to the body the handler expects, then reuse the same handler
const findBuyersGet: RequestHandler = (req, res, next) => {
  try {
    const q = req.query as Record<string, unknown>;
    (req as any).body = {
      supplierDomain: String(q.site ?? q.supplier ?? q.domain ?? q.host ?? ""),
      region: String(q.region ?? "US/CA"),
      radiusMi: Number((q.radiusMi ?? q.radius ?? 50) as any),
      personaTitles: Array.isArray(q.titles)
        ? (q.titles as string[]).map(s => s.trim()).filter(Boolean)
        : typeof q.titles === "string"
          ? (q.titles as string).split(",").map(s => s.trim()).filter(Boolean)
          : undefined,
    };
    return findBuyers(req, res, next);
  } catch (err) {
    return next(err);
  }
};

app.get("/find-buyers", findBuyersGet);
app.get("/api/v1/find-buyers", findBuyersGet);

// ---- Leads list used by Refresh Hot/Warm in the panel ----
// Stub an empty list for now so the panel stops 404ing.
// (We can wire this to your cache/store later.)
app.get("/api/v1/leads", (_req: Request, res: Response) => {
  res.status(200).json([]);
});

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