// src/routes/metrics.ts
//
// Debug/QA endpoints to preview ontology extraction results.
// Useful for Step 3 tuning and to verify the "never empty" metric rule.
//
// GET /api/metrics/preview?host=acme.com[&maxPages=8]
// -> { ok, host, bytes, pages, products, sectors, hotMetricsBySector }
//
// GET /api/metrics/ping -> { ok:true }

import { Router, Request, Response } from "express";
import { withCache, daily } from "../shared/guards";
import { CFG } from "../shared/env";
import { spiderHost } from "../shared/spider";
import { productsFrom, sectorsFrom, metricsBySector } from "../shared/ontology";

const r = Router();

function normHost(raw?: string): string | undefined {
  if (!raw) return;
  const h = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9.-]+$/.test(h) ? h : undefined;
}

r.get("/ping", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

r.get("/preview", async (req: Request, res: Response) => {
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
      // crawl (use conservative, type-safe options)
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

      const hot = metricsBySector(corpus, sectors, products);

      return {
        ok: true,
        host,
        bytes,
        pages,
        products,
        sectors,
        hotMetricsBySector: hot,
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

export default r;