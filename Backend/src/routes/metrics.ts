// src/routes/metrics.ts
//
// Consolidated metrics router:
// - Lead/watchers tools (your original endpoints)
// - Debug preview of ontology extraction (crawler + ontology)
//   GET /api/metrics/preview?host=acme.com[&maxPages=8]
//
// Mount path (from index.ts): app.use("/api/metrics", metricsRouter)

import { Router, Request, Response } from "express";

// --- your lead/watchers store ---
import {
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  resetHotWarm,
  buckets,
  watchers as getWatchers,
  Temp,
  StoredLead,
} from "../shared/memStore";

// --- preview bits: spider + ontology + guards ---
import { withCache, daily } from "../shared/guards";
import { CFG } from "../shared/env";
import { spiderHost } from "../shared/spider";
import { productsFrom, sectorsFrom, metricsBySector } from "../shared/ontology";

export const metricsRouter = Router();

/* ------------------------------ helpers ---------------------------------- */

function normHost(raw?: string): string | undefined {
  if (!raw) return;
  const h = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9.-]+$/.test(h) ? h : undefined;
}

/* ------------------------------ health ----------------------------------- */

metricsRouter.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

metricsRouter.get("/ping", (_req, res) => {
  res.json({ ok: true });
});

/* -------------------------- lead/watchers API ----------------------------- */

// GET /api/metrics/watchers?host=example.com
metricsRouter.get("/watchers", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });

  const w = getWatchers(host); // arrays (so .length works)
  res.json({
    ok: true,
    host,
    counts: { watchers: w.watchers.length, competitors: w.competitors.length },
    watchers: w.watchers,
    competitors: w.competitors,
  });
});

// GET /api/metrics/buckets
metricsRouter.get("/buckets", (_req: Request, res: Response) => {
  res.json({ ok: true, ...buckets() });
});

// POST /api/metrics/claim
// body: { host, title?, platform?, why?, temperature? }
metricsRouter.post("/claim", (req: Request, res: Response) => {
  const { host, title, platform, why, temperature } = (req.body ?? {}) as {
    host?: string;
    title?: string;
    platform?: string;
    why?: string;
    temperature?: Temp | string;
  };

  if (!host) return res.status(400).json({ ok: false, error: "missing host" });

  // make sure a lead exists, then update it
  ensureLeadForHost(host);

  const patch: Partial<StoredLead> = {
    title,
    platform,
    why,
    saved: true,
  };

  // optional temperature bump
  const t: Temp | undefined =
    temperature === "hot" || temperature === "warm" || temperature === "cold"
      ? (temperature as Temp)
      : undefined;
  if (t) patch.temperature = t;

  const updated = saveByHost(host, patch);
  return res.json({ ok: true, lead: updated });
});

// GET /api/metrics/hot?host=...
metricsRouter.get("/hot", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });
  const lead = replaceHotWarm(host, "hot");
  res.json({ ok: true, lead });
});

// GET /api/metrics/warm?host=...
metricsRouter.get("/warm", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });
  const lead = replaceHotWarm(host, "warm");
  res.json({ ok: true, lead });
});

// GET /api/metrics/reset?host=...
metricsRouter.get("/reset", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });
  const lead = resetHotWarm(host);
  res.json({ ok: true, lead });
});

// GET /api/metrics/deepen?host=...
// Hook point for future enrichment; returns a friendly 404 for now.
metricsRouter.get("/deepen", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });
  return res.status(404).json({ ok: false, error: "nothing to deepen" });
});

/* -------------------------- preview (crawler) ----------------------------- */

// GET /api/metrics/preview?host=acme.com[&maxPages=8]
metricsRouter.get("/preview", async (req: Request, res: Response) => {
  try {
    const host = normHost(String(req.query.host || ""));
    if (!host) return res.status(400).json({ ok: false, error: "bad_host" });

    // simple per-IP daily cap (reuse classify limits)
    const capKey = `metrics:${(req.ip || req.socket.remoteAddress || "ip")}`;
    const limit = Math.max(5, CFG.classifyDailyLimit || 20);
    if ((daily.get(capKey) || 0) >= limit) {
      return res.status(200).json({ ok: false, error: "quota", remaining: 0 });
    }

    const maxPagesQ = Number(req.query.maxPages ?? 8);
    const maxPages = Math.min(Math.max(3, maxPagesQ || 0), 16);
    const cacheKey = `metrics:preview:${host}:${maxPages}`;

    const result = await withCache(cacheKey, (CFG.classifyCacheTtlS || 3600) * 1000, async () => {
      const crawl = await spiderHost(host, {
        maxPages,
        timeoutMs: Math.max(5000, CFG.fetchTimeoutMs || 7000),
      });

      const bytes = Number((crawl as any).bytes || 0);
      const pages = Array.isArray((crawl as any).pages) ? (crawl as any).pages.length : 0;

      const text = String((crawl as any).text || "");
      const title = String((crawl as any).title || "");
      const description = String((crawl as any).description || "");
      const keywords: string[] = ((crawl as any).keywords || []) as string[];
      const corpus = [title, description, text].join("\n");

      const products = productsFrom(corpus, keywords);
      const sectors = sectorsFrom(corpus, keywords);
      const hotMetrics = metricsBySector(corpus, sectors, products);

      return {
        ok: true,
        host,
        bytes,
        pages,
        products,
        sectors,
        hotMetricsBySector: hotMetrics,
        fetchedAt: new Date().toISOString(),
      };
    });

    daily.inc(capKey, 1);
    return res.json({ ...(result as object), cached: true });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "metrics-failed", detail: msg });
  }
});

export default metricsRouter;