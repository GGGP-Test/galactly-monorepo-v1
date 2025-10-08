// src/routes/metrics.ts
//
// Consolidated metrics router (upgraded):
// - Your original lead/watchers tools
// - Preview crawler+ontology
// - NEW: Scoreboard KPIs (counts + %s) for a host
//
// Endpoints:
//   GET  /api/metrics/ping
//   GET  /api/metrics/healthz
//   GET  /api/metrics/watchers?host=acme.com
//   GET  /api/metrics/buckets
//   POST /api/metrics/claim          { host, title?, platform?, why?, temperature? }
//   GET  /api/metrics/hot?host=...
//   GET  /api/metrics/warm?host=...
//   GET  /api/metrics/reset?host=...
//   GET  /api/metrics/preview?host=acme.com[&maxPages=8]
//   GET  /api/metrics/scoreboard?host=acme.com[&probe=1]
//
// Mount (index.ts):  app.use("/api/metrics", metricsRouter);

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

// --- NEW: scoreboard deps (read-only) ---
import { loadCatalog } from "../shared/catalog";
import * as Prefs from "../shared/prefs";
import * as Ads from "../shared/ads-store";

export const metricsRouter = Router();

const F: (u: string, i?: any) => Promise<any> = (globalThis as any).fetch;

/* ------------------------------ helpers ---------------------------------- */

function normHost(raw?: string): string | undefined {
  if (!raw) return;
  const h = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9.-]+$/.test(h) ? h : undefined;
}
function pct(n: number, d: number): number {
  const x = Number(d) > 0 ? (Number(n) / Number(d)) * 100 : 0;
  if (!Number.isFinite(x)) return 0;
  return Number(Math.max(0, Math.min(100, x)).toFixed(1));
}
function clamp01(x: any): number { const v = Number(x); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
function asBool(v: any): boolean { return !!v; }

/* ------------------------------ health ----------------------------------- */

metricsRouter.get("/healthz", (_req, res) => { res.json({ ok: true }); });
metricsRouter.get("/ping",    (_req, res) => { res.json({ ok: true }); });

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

/* ---------------------------- NEW: scoreboard ------------------------------ */

// GET /api/metrics/scoreboard?host=acme.com[&probe=1]
metricsRouter.get("/scoreboard", async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    const host = normHost(String(req.query.host || ""));
    const doProbe = String(req.query.probe || "0") === "1";
    if (!host) return res.status(400).json({ ok: false, error: "bad_host" });

    // persona/prefs (best-effort)
    const prefs =
      (typeof (Prefs as any).get === "function" && (Prefs as any).get(host)) ||
      (typeof (Prefs as any).getPrefs === "function" && (Prefs as any).getPrefs(host)) ||
      {};
    const likeTags: string[] = Array.isArray((prefs as any).categoriesAllow) ? (prefs as any).categoriesAllow : [];
    const city = String((prefs as any).city || (prefs as any)?.targeting?.city || "");

    // catalog stats (best-effort)
    let catalogTotal = 0; const byTier: Record<string, number> = {};
    try {
      const cat = await loadCatalog();
      const rows: any[] =
        Array.isArray((cat as any)?.rows) ? (cat as any).rows :
        (Array.isArray(cat as any) ? (cat as any) : []);
      catalogTotal = rows.length || 0;
      for (const r0 of rows as any[]) {
        const t = String((r0?.tier || (Array.isArray(r0?.tiers) ? r0.tiers[0] : "C") || "C")).toUpperCase();
        const k = (t === "A" || t === "B" || t === "C") ? t : "C";
        byTier[k] = (byTier[k] || 0) + 1;
      }
    } catch {}

    // ads activity (store optional)
    const adsStats = (typeof (Ads as any).getStats === "function") ? (Ads as any).getStats(host) : null;
    const adsSignal = (typeof (Ads as any).getSignal === "function") ? clamp01((Ads as any).getSignal(host)) : 0;

    // optional probe via internal /scores/explain
    let explain: any = null;
    if (doProbe) {
      try {
        const port = Number(CFG.port || process.env.PORT || 8787);
        const url = `http://127.0.0.1:${port}/api/scores/explain?host=${encodeURIComponent(host)}`;
        const r = await F(url, { redirect: "follow" });
        if (r?.ok) explain = await r.json();
      } catch {}
    }

    // unpack probe (safe defaults)
    const pixelActivity = clamp01(explain?.signals?.pixelActivity ?? 0);
    const adsActivity = clamp01(explain?.signals?.adsActivity ?? adsSignal ?? 0);
    const cta = explain?.signals?.cta || {};
    const commerce = explain?.signals?.commerce || {};
    const recency = explain?.signals?.recency || {};
    const px = explain?.signals?.pixels || {};
    const stack = explain?.signals?.stack || {};
    const reasons: string[] = Array.isArray(explain?.reasons) ? explain.reasons : [];
    const score = Number(explain?.score ?? NaN);
    const band = String(explain?.band || "").toUpperCase();

    // build KPI list (~36–40)
    const metrics: Array<{ key: string; label: string; value: any; unit: string; pct: number }> = [];

    // pixel intensity + buckets
    metrics.push({ key: "px_intensity", label: "Pixel intensity", value: pixelActivity, unit: "0..1", pct: pct(pixelActivity, 1) });
    metrics.push({ key: "px_ga4",       label: "GA4",              value: asBool(px.ga4), unit: "bool", pct: asBool(px.ga4) ? 100 : 0 });
    metrics.push({ key: "px_gtm",       label: "GTM",              value: asBool(px.gtm), unit: "bool", pct: asBool(px.gtm) ? 100 : 0 });
    metrics.push({ key: "px_meta",      label: "Meta Pixel",       value: asBool(px.meta), unit: "bool", pct: asBool(px.meta) ? 100 : 0 });
    metrics.push({ key: "px_tiktok",    label: "TikTok Pixel",     value: asBool(px.tiktok), unit: "bool", pct: asBool(px.tiktok) ? 100 : 0 });
    metrics.push({ key: "px_linkedin",  label: "LinkedIn",         value: asBool(px.linkedin), unit: "bool", pct: asBool(px.linkedin) ? 100 : 0 });
    metrics.push({ key: "px_bing",      label: "Bing UET",         value: asBool(px.bing), unit: "bool", pct: asBool(px.bing) ? 100 : 0 });

    // stack presence
    metrics.push({ key: "stack_shopify",     label: "Shopify",     value: asBool(stack.shopify), unit: "bool", pct: asBool(stack.shopify) ? 100 : 0 });
    metrics.push({ key: "stack_bigcommerce", label: "BigCommerce", value: asBool(stack.bigcommerce), unit: "bool", pct: asBool(stack.bigcommerce) ? 100 : 0 });
    metrics.push({ key: "stack_woocommerce", label: "WooCommerce", value: asBool(stack.woocommerce), unit: "bool", pct: asBool(stack.woocommerce) ? 100 : 0 });
    metrics.push({ key: "stack_wordpress",   label: "WordPress",   value: asBool(stack.wordpress), unit: "bool", pct: asBool(stack.wordpress) ? 100 : 0 });
    metrics.push({ key: "stack_wix",         label: "Wix",         value: asBool(stack.wix), unit: "bool", pct: asBool(stack.wix) ? 100 : 0 });
    metrics.push({ key: "stack_squarespace", label: "Squarespace", value: asBool(stack.squarespace), unit: "bool", pct: asBool(stack.squarespace) ? 100 : 0 });

    // CTA & commerce
    const ctaCount = Number(cta?.count || 0);
    metrics.push({ key: "cta_count",    label: "CTA signals",      value: ctaCount, unit: "0..5", pct: pct(ctaCount, 5) });
    metrics.push({ key: "cta_form",     label: "Form present",     value: asBool(cta?.hasForm), unit: "bool", pct: asBool(cta?.hasForm) ? 100 : 0 });
    metrics.push({ key: "cta_email",    label: "Email present",    value: asBool(cta?.hasEmail), unit: "bool", pct: asBool(cta?.hasEmail) ? 100 : 0 });
    metrics.push({ key: "cta_phone",    label: "Phone present",    value: asBool(cta?.hasPhone), unit: "bool", pct: asBool(cta?.hasPhone) ? 100 : 0 });
    metrics.push({ key: "cta_rfq",      label: "Quote intent",     value: asBool(cta?.hasQuote), unit: "bool", pct: asBool(cta?.hasQuote) ? 100 : 0 });
    metrics.push({ key: "cta_buy",      label: "Buy intent",       value: asBool(cta?.hasBuy), unit: "bool", pct: asBool(cta?.hasBuy) ? 100 : 0 });

    metrics.push({ key: "commerce_cart",     label: "Cart",        value: asBool(commerce?.hasCart), unit: "bool", pct: asBool(commerce?.hasCart) ? 100 : 0 });
    metrics.push({ key: "commerce_checkout", label: "Checkout",    value: asBool(commerce?.hasCheckout), unit: "bool", pct: asBool(commerce?.hasCheckout) ? 100 : 0 });
    metrics.push({ key: "commerce_sku",      label: "SKU",         value: asBool(commerce?.hasSku), unit: "bool", pct: asBool(commerce?.hasSku) ? 100 : 0 });
    metrics.push({ key: "commerce_pricing",  label: "Pricing words", value: asBool(commerce?.hasPriceWord), unit: "bool", pct: asBool(commerce?.hasPriceWord) ? 100 : 0 });

    // Ads
    metrics.push({ key: "ads_activity",   label: "Ads activity",    value: adsActivity, unit: "0..1", pct: pct(adsActivity, 1) });
    if (adsStats) {
      const dens = Number(adsStats.densityLast30 || 0);
      const diversity = Array.isArray(adsStats.platforms) ? adsStats.platforms.length : 0;
      const recDays = Number(adsStats.recencyDays || Infinity);
      const recScore = Number.isFinite(recDays) ? Math.max(0, Math.min(100, Math.round(100 * Math.pow(0.5, recDays / 14)))) : 0;
      metrics.push({ key: "ads_density_30d", label: "Ads density (30d)", value: dens, unit: "count", pct: Math.min(100, dens * 12.5) });
      metrics.push({ key: "ads_platforms",   label: "Ads platform diversity", value: diversity, unit: "count", pct: Math.min(100, diversity * 25) });
      metrics.push({ key: "ads_recency",     label: "Ads recency score", value: recScore, unit: "0..100", pct: recScore });
      metrics.push({ key: "ads_signal",      label: "Ads unified signal", value: clamp01((Ads as any).getSignal ? (Ads as any).getSignal(host) : 0), unit: "0..1", pct: pct(adsSignal, 1) });
    }

    // Recency
    const recYear = Number(recency?.recentYear || 0);
    metrics.push({ key: "recency_year",    label: "Has recent year", value: asBool(recency?.hasRecentYear), unit: "bool", pct: asBool(recency?.hasRecentYear) ? 100 : 0 });
    metrics.push({ key: "recency_launch",  label: "Launch phrasing", value: asBool(recency?.hasUpdateWords), unit: "bool", pct: asBool(recency?.hasUpdateWords) ? 100 : 0 });
    if (recYear > 0) {
      const gap = Math.max(0, new Date().getFullYear() - recYear);
      const freshness = Math.max(0, 100 - Math.min(100, gap * 40)); // 0yr=100, 1yr=60, 2yr=20, ≥3≈0
      metrics.push({ key: "recency_freshness", label: "Content freshness", value: freshness, unit: "0..100", pct: freshness });
    }

    // Persona completeness
    const likeCount = Array.isArray(likeTags) ? likeTags.length : 0;
    metrics.push({ key: "prefs_like_tags", label: "Persona: tags", value: likeCount, unit: "count", pct: pct(likeCount, 12) });
    metrics.push({ key: "prefs_city",      label: "Persona: city set", value: !!city, unit: "bool", pct: city ? 100 : 0 });

    // Score/band if probed
    if (Number.isFinite(score)) {
      metrics.push({ key: "score_raw",       label: "Scorer: raw",  value: Number(score.toFixed(1)), unit: "0..100", pct: Math.max(0, Math.min(100, Number(score))) });
      const bandPct = band === "HOT" ? 100 : band === "WARM" ? 66.7 : 33.3;
      metrics.push({ key: "score_band",      label: "Scorer: band", value: band || "?", unit: "enum", pct: Number(bandPct.toFixed(1)) });
      metrics.push({ key: "score_explain",   label: "Explain reasons", value: reasons.length, unit: "items", pct: pct(reasons.length, 12) });
    }

    // Catalog distribution
    const A = Number(byTier["A"] || 0), B = Number(byTier["B"] || 0), C = Number(byTier["C"] || 0);
    if (catalogTotal > 0) {
      metrics.push({ key: "catalog_total",  label: "Catalog size", value: catalogTotal, unit: "rows", pct: 100 });
      metrics.push({ key: "catalog_A",      label: "Tier A share", value: pct(A, catalogTotal), unit: "%", pct: pct(A, catalogTotal) });
      metrics.push({ key: "catalog_B",      label: "Tier B share", value: pct(B, catalogTotal), unit: "%", pct: pct(B, catalogTotal) });
      metrics.push({ key: "catalog_C",      label: "Tier C share", value: pct(C, catalogTotal), unit: "%", pct: pct(C, catalogTotal) });
    }

    return res.json({
      ok: true,
      host,
      probed: !!explain,
      persona: { city: city || null, likeTags: likeTags.slice(0, 12) },
      catalog: { total: catalogTotal, byTier },
      ads: adsStats ? {
        lastSeen: adsStats.lastSeen || null,
        densityLast30: adsStats.densityLast30 || 0,
        platforms: adsStats.platforms || [],
        signal: adsSignal,
      } : null,
      probe: explain ? {
        band, score, reasons: reasons.slice(0, 12),
        signals: explain.signals,
      } : null,
      metrics,
      ms: Date.now() - t0,
    });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "metrics-scoreboard-failed", detail: String(err?.message || err) });
  }
});

export default metricsRouter;