// Backend/src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import morgan from "morgan";
import mountBuyerRoutes from "./routes/buyers";

const app = express();
const PORT = Number(process.env.PORT || process.env.APP_PORT || 8787);

app.disable("x-powered-by");
app.use(cors({ origin: "*", maxAge: 600 }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Health endpoints (both paths so UI/Scripts can pick either)
app.get("/health", (_req: Request, res: Response) => res.status(200).send("OK"));
app.get("/healthz", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// Root sanity
app.get("/", (_req, res) => res.status(200).json({ service: "artemis-backend", ok: true }));

// Business routes
mountBuyerRoutes(app);

// Error fence
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[ERROR]", err?.stack || err);
  res.status(500).json({ error: "internal_error", detail: String(err?.message || err) });
});

app.listen(PORT, () => {
  console.log(`[artemis] API listening on ${PORT}`);
});

export default app;
