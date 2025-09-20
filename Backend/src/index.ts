// src/index.ts
import express from "express";
import cors from "cors";

// NOTE: adjust this import only if your function is exported differently.
// We avoid type imports here to keep builds green.
import { findWarmBuyers } from "./services/find-buyers";

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Healthcheck (used by Dockerfile)
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// --- TEMP STUB so the panel's "Refresh Hot/Warm" doesn't 404 ---
app.get("/api/v1/leads", (_req, res) => {
  res.json({ items: [], next: null });
});

// --- Main endpoint used by the blue "Find buyers" button ---
app.post("/find-buyers", async (req, res, next) => {
  try {
    // Narrow & sanitize without relying on external types
    const body = (req.body ?? {}) as {
      supplier?: string;
      region?: string;
      radiusMiles?: number | string;
      personaTitles?: string[];
      pro?: boolean;
    };

    if (!body.supplier) {
      return res
        .status(400)
        .json({ error: "BadRequest", message: "Missing 'supplier' (domain)" });
    }

    const input = {
      supplier: String(body.supplier),
      region: (body.region ?? "US/CA") as string,
      radiusMiles: Number(body.radiusMiles ?? 50),
      personaTitles: Array.isArray(body.personaTitles) ? body.personaTitles : [],
      pro: Boolean(body.pro),
    };

    const result = await findWarmBuyers(input);
    return res.json(result ?? { hot: [], warm: [], notes: [] });
  } catch (err) {
    return next(err);
  }
});

// 404 fallback (what you’re seeing now)
app.use((req, res) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

// Error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[buyers-api] error:", err);
  res.status(500).json({ error: "INTERNAL", message: err?.message ?? "unknown" });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`[buyers-api] listening on ${port}`);
});