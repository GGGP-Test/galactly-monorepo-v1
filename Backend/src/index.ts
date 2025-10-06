// src/index.ts
//
// Artemis BV1 — API bootstrap (Express, no external deps).
// Mounts routes and exposes /api/health for Docker healthcheck.

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { CFG } from "./shared/env";
import { loadCatalog, type BuyerRow } from "./shared/catalog";

// Routers
import LeadsRouter from "./routes/leads";
import ClassifyRouter from "./routes/classify";
import PrefsRouter from "./routes/prefs";
import CatalogRouter from "./routes/catalog";
import AuditRouter from "./routes/audit";
import EventsRouter from "./routes/events";
import ScoresRouter from "./routes/scores";
import AdsRouter from "./routes/ads"; // NEW

const app = express();
const startedAt = Date.now();
const PORT = Number(CFG.port || process.env.PORT || 8787);

// --- tiny CORS (no dependency) ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  // include x-admin-key for admin-protected routes
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use(express.json({ limit: "1mb" }));

// --- basic pings ---
app.get("/api/ping", (_req, res) => res.json({ pong: true, now: new Date().toISOString() }));
app.get("/ping", (_req, res) => res.json({ pong: true, now: new Date().toISOString() }));

// --- health helpers ---
function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map((x) => (x == null ? "" : String(x))).filter(Boolean);
}
function toArray(cat: unknown): BuyerRow[] {
  const anyCat = cat as any;
  if (Array.isArray(anyCat)) return anyCat as BuyerRow[];
  if (Array.isArray(anyCat?.rows)) return anyCat.rows as BuyerRow[];
  if (Array.isArray(anyCat?.items)) return anyCat.items as BuyerRow[];
  return [];
}

app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    const cat = await loadCatalog();
    const rows = toArray(cat);

    const byTier: Record<string, number> = {};
    for (const r of rows) {
      const tiers = arr((r as any).tiers);
      if (tiers.length === 0) tiers.push("?");
      for (const t of tiers) byTier[t] = (byTier[t] || 0) + 1;
    }

    res.json({
      service: "buyers-api",
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      env: {
        allowTiers: Array.from(CFG.allowTiers || new Set(["A", "B", "C"])).join(""),
      },
      catalog: { total: rows.length, byTier },
      now: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "health-failed", detail: String(err?.message || err) });
  }
});

// extra healthz for Dockerfile HEALTHCHECK
app.get("/healthz", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("ok");
});

// --- routers ---
app.use("/api/leads", LeadsRouter);
app.use("/api/classify", ClassifyRouter);
app.use("/api/prefs", PrefsRouter);
app.use("/api/catalog", CatalogRouter);
app.use("/api/audit", AuditRouter);
app.use("/api/events", EventsRouter);
app.use("/api/scores", ScoresRouter);
app.use("/api/ads", AdsRouter); // NEW

// --- serve Docs/ or docs/ if present (admin.html) ---
try {
  const tryDirs = [
    path.join(__dirname, "..", "docs"),
    path.join(__dirname, "..", "Docs"),
  ];
  for (const d of tryDirs) {
    if (fs.existsSync(d)) {
      app.use("/", express.static(d, { index: "admin.html" }));
      break;
    }
  }
} catch { /* ignore */ }

// --- error guard ---
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err?.message || String(err);
  res.status(200).json({ ok: false, error: "server", detail: msg });
});

// --- start ---
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[buyers-api] listening on :${PORT} (env=${process.env.NODE_ENV || "development"})`);
});

export default app;