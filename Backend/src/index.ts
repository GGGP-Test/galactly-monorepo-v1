// Backend/src/index.ts
//
// Artemis BV1 — API bootstrap (Express, no external deps).
// Webhook FIRST (raw body inside the router), then JSON parser, then the rest.

/* eslint-disable @typescript-eslint/no-var-requires */
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { CFG } from "./shared/env";
import { loadCatalog, type BuyerRow } from "./shared/catalog";

// ✅ hard imports so bundlers can’t tree-shake routers away
import StripeWebhook from "./routes/stripe-webhook";
import GateRouter    from "./routes/gate";         // /api/v1/*
import ClaimRouter   from "./routes/claim";        // /api/claim/*
import AuditRouter   from "./routes/audit";        // /api/audit/*
import ClaimAdmin    from "./routes/claim-admin";  // /api/claim-admin/*
import QuotaRouter   from "./routes/quota";        // /api/quota/*   <-- NEW

// other core routers
import LeadsRouter     from "./routes/leads";
import LeadsWebRouter  from "./routes/leads-web";
import ClassifyRouter  from "./routes/classify";
import PrefsRouter     from "./routes/prefs";
import CatalogRouter   from "./routes/catalog";
import EventsRouter    from "./routes/events";
import ScoresRouter    from "./routes/scores";

function safeRequire(p: string): any { try { return require(p); } catch { return null; } }
function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map((x)=> (x==null?"":String(x))).filter(Boolean);
}
function toArray(cat: unknown): BuyerRow[] {
  const anyCat = cat as any;
  if (Array.isArray(anyCat)) return anyCat as BuyerRow[];
  if (Array.isArray(anyCat?.rows)) return anyCat.rows as BuyerRow[];
  if (Array.isArray(anyCat?.items)) return anyCat.items as BuyerRow[];
  return [];
}

const app = express();
const startedAt = Date.now();
const PORT = Number(CFG.port || process.env.PORT || 8787);

// ---- CORS (tiny, permissive while we iterate) ------------------------------
app.use((_, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-admin-key, x-admin-token, x-user-email, x-user-plan"
  );
  res.setHeader("Access-Control-Expose-Headers", "Content-Type");
  next();
});
app.use((req, res, next) => { if (req.method === "OPTIONS") return res.status(204).end(); next(); });

// ---- STRIPE WEBHOOK (mount BEFORE express.json) ----------------------------
app.use("/api/stripe/webhook", StripeWebhook);
app.get("/api/stripe/webhook/_ping", (_req, res) => res.type("text/plain").send("stripe-webhook-mounted"));

// ---- JSON body parser for the rest of the API ------------------------------
app.use(express.json({ limit: "1mb" }));

// ---- Canonical mounts (deterministic order) --------------------------------
app.use("/api/v1",          GateRouter);    // _ping, whoami, limits, onboard
app.use("/api/claim",       ClaimRouter);   // _ping, own, hide
app.use("/api/audit",       AuditRouter);   // ping, window, stats, export.csv
app.use("/api/claim-admin", ClaimAdmin);    // _ping, list, export.csv, unhide, clear
app.use("/api/quota",       QuotaRouter);   // _ping, peek, bump  <-- NEW

// optional boot: plan flags (file-based overrides for dev)
const planFlags = safeRequire("./shared/plan-flags");
if (planFlags?.loadPlanStoreFromFile) { try { planFlags.loadPlanStoreFromFile(); } catch {} }

// ---- pings & health --------------------------------------------------------
app.get("/api/ping", (_req, res) => res.json({ pong: true, now: new Date().toISOString() }));
app.get("/ping",      (_req, res) => res.json({ pong: true, now: new Date().toISOString() }));

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
      env: { allowTiers: Array.from(CFG.allowTiers || new Set(["A","B","C"])).join("") },
      catalog: { total: rows.length, byTier },
      now: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(200).json({ ok:false, error:"health-failed", detail:String(err?.message||err) });
  }
});

app.get("/healthz", (_req, res) => { res.setHeader("Content-Type","text/plain; charset=utf-8"); res.end("ok"); });

// ---- other core routers ----------------------------------------------------
app.use("/api/leads",    LeadsRouter);
app.use("/api/web",      LeadsWebRouter);
app.use("/api/classify", ClassifyRouter);
app.use("/api/prefs",    PrefsRouter);
app.use("/api/catalog",  CatalogRouter);
app.use("/api/events",   EventsRouter);
app.use("/api/scores",   ScoresRouter);

// ---- optional routers (best-effort) ----------------------------------------
try { const AdsRouter = safeRequire("./routes/ads")?.default; if (AdsRouter) app.use("/api/ads", AdsRouter); } catch {}
try {
  const Buyers = safeRequire("./routes/buyers");
  if (Buyers?.default)   app.use("/api/buyers", Buyers.default);
  if (Buyers?.RootAlias) app.use("/api/find",   Buyers.RootAlias);
} catch {}
try { const MetricsRouter = safeRequire("./routes/metrics")?.default; if (MetricsRouter) app.use("/api/metrics", MetricsRouter); } catch {}
try { const CreditsRouter = safeRequire("./routes/credits")?.default; if (CreditsRouter) app.use("/api/credits", CreditsRouter); } catch {}
try { const ContextRouter = safeRequire("./routes/context")?.default; if (ContextRouter) app.use("/api/context", ContextRouter); } catch {}
try { const GateV1Alt = safeRequire("./routes/GATE")?.default; if (GateV1Alt) app.use("/api/v1", GateV1Alt); } catch {}
try { const LexRoute = safeRequire("./routes/lexicon")?.default; if (LexRoute) app.use("/api/lexicon", LexRoute); } catch {}
try { const FeedbackRouter = safeRequire("./routes/feedback")?.default; if (FeedbackRouter) app.use("/api/feedback", FeedbackRouter); } catch {}

// ---- docs for local dev ----------------------------------------------------
try {
  const docsDir = path.join(__dirname, "..", "docs");
  if (fs.existsSync(docsDir)) { app.use("/", express.static(docsDir, { index: "admin.html" })); }
} catch {}

// ---- error guard -----------------------------------------------------------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err?.message || String(err);
  res.status(200).json({ ok: false, error: "server", detail: msg });
});

// ---- start -----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[buyers-api] listening on :${PORT} (env=${process.env.NODE_ENV || "development"})`);
  console.log("[buyers-api] webhook     mounted at /api/stripe/webhook");
  console.log("[buyers-api] gate        mounted at /api/v1");
  console.log("[buyers-api] claim       mounted at /api/claim");
  console.log("[buyers-api] audit       mounted at /api/audit");
  console.log("[buyers-api] claim-admin mounted at /api/claim-admin");
  console.log("[buyers-api] quota       mounted at /api/quota"); // <-- NEW
});

export default app;