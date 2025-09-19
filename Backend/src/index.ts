import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";

// create app
const app = express();

// middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// health
app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// api (kept for Free Panel/backward-compat)
app.post("/api/v1/leads/find-buyers", findBuyers);

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

// error
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const any = err as { status?: number; message?: string };
  const status = typeof any?.status === "number" ? any.status : 500;
  const message = any?.message ?? "Internal Server Error";
  res.status(status).json({ error: "INTERNAL_ERROR", message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`[server] listening on :${port}`);
});

export default app;