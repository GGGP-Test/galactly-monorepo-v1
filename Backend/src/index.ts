// src/index.ts
//
// Artemis BV1 — API bootstrap (Express, no external deps).
// CJS-safe. Mounts all routers (core hard; extras safe-required).
/* eslint-disable @typescript-eslint/no-var-requires */

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { CFG } from "./shared/env";
import { loadCatalog, type BuyerRow } from "./shared/catalog";

// ---- helpers ---------------------------------------------------------------

function safeRequire(p: string): any {
  try { return require(p); } catch { return null; }
}

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

// ---- app -------------------------------------------------------------------

const app = express();
const startedAt = Date.now();
const PORT = Number(CFG.port || process.env.PORT || 8787);

// tiny CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-admin-key, x-admin-token, x-user-email, x-user-plan"
  );
  res.setHeader("Access-Control-Expose-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use(express.json({ limit: "1mb" }));

// optional boot: plan flags (safe if file missing)
const planFlags = safeRequire("./shared/plan-flags");
if (planFlags?.loadPlanStoreFromFile) {
  try { planFlags.loadPlanStoreFromFile(); } catch { /* ignore */ }
}

// ---- pings & health --------------------------------------------------------

app.get("/api/ping", (_req, res) => res.json({ pong: true, now: new Date().toISOString() }));
app.get("/ping", (_req, res) => res.json({ pong: true, now: new Date().toISOString() }));

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

app.get("/healthz", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("ok");
});

// ---- core routers (hard imports) -------------------------------------------
import LeadsRouter from "./routes/leads";
import LeadsWebRouter from "./routes/leads-web";
import ClassifyRouter from "./routes/classify";
import PrefsRouter from "./routes/prefs";
import CatalogRouter from "./routes/catalog";
import AuditRouter from "./routes/audit";
import EventsRouter from "./routes/events";
import ScoresRouter from "./routes/scores";

app.use("/api/leads", LeadsRouter);
app.use("/api/web", LeadsWebRouter);    // web-first discovery
app.use("/api/classify", ClassifyRouter);
app.use("/api/prefs", PrefsRouter);
app.use("/api/catalog", CatalogRouter);
app.use("/api/audit", AuditRouter);
app.use("/api/events", EventsRouter);
app.use("/api/scores", ScoresRouter);

// ---- optional routers (safe-required; mount only if present) ---------------
try {
  const AdsRouter = safeRequire("./routes/ads")?.default;
  if (AdsRouter) app.use("/api/ads", AdsRouter);
} catch { /* ignore */ }

try {
  const Buyers = safeRequire("./routes/buyers");
  if (Buyers?.default) app.use("/api/buyers", Buyers.default);
  if (Buyers?.RootAlias) app.use("/api/find", Buyers.RootAlias);
} catch { /* ignore */ }

try {
  const MetricsRouter = safeRequire("./routes/metrics")?.default;
  if (MetricsRouter) app.use("/api/metrics", MetricsRouter);
} catch { /* ignore */ }

try {
  const CreditsRouter = safeRequire("./routes/credits")?.default;
  if (CreditsRouter) app.use("/api/credits", CreditsRouter);
} catch { /* ignore */ }

try {
  const ContextRouter = safeRequire("./routes/context")?.default;
  if (ContextRouter) app.use("/api/context", ContextRouter);
} catch { /* ignore */ }

try {
  const GateRouter = safeRequire("./routes/gate")?.default;
  if (GateRouter) app.use("/api/v1", GateRouter);
} catch { /* ignore */ }

try {
  const LexRoute = safeRequire("./routes/lexicon")?.default;
  if (LexRoute) app.use("/api/lexicon", LexRoute);
} catch { /* ignore */ }

try {
  const FeedbackRouter = safeRequire("./routes/feedback")?.default;
  if (FeedbackRouter) app.use("/api/feedback", FeedbackRouter);
} catch { /* ignore */ }

// ---- docs for local dev (prod GH Pages serves /docs) -----------------------

try {
  const docsDir = path.join(__dirname, "..", "docs");
  if (fs.existsSync(docsDir)) {
    app.use("/", express.static(docsDir, { index: "admin.html" }));
  }
} catch { /* ignore */ }

// ---- error guard -----------------------------------------------------------

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err?.message || String(err);
  res.status(200).json({ ok: false, error: "server", detail: msg });
});

// ---- start -----------------------------------------------------------------

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[buyers-api] listening on :${PORT} (env=${process.env.NODE_ENV || "development"})`);
});

export default app;