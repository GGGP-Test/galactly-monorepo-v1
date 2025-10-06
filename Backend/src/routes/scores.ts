// src/routes/scores.ts
//
// Explainable scoring for a single host.
// - GET  /api/scores/ping
// - GET  /api/scores/explain?host=acme.com[&ads=0..1][&url=...]
// - POST /api/scores/explain { host, ads?, url? }
//
// What it does (no external deps):
//   1) fetches one page (homepage unless ?url= supplied) with timeout
//   2) runs tech + signals extraction (pixels, stack, CTA, pricing, cart, recency)
//   3) builds a lightweight "row" view from those signals
//   4) fetches prefs for the host and scores the row via trc.scoreRow()
//   5) returns score, band, reasons + a signals summary for debugging

import { Router, Request, Response } from "express";
import { getPrefs, normalizeHost as normHost } from "../shared/prefs";
import { computeSignals, summarizeSignals } from "../shared/signals";
import { scoreRow, classifyScore } from "../shared/trc";

const r = Router();

// ---- tiny helpers -------------------------------------------------------

const F: (u: string, init?: any) => Promise<{
  ok: boolean; status: number; url: string; text(): Promise<string>;
  headers: { get(name: string): string | null };
}> = (globalThis as any).fetch;

function toURL(hostOrUrl: string): string {
  const s = String(hostOrUrl || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const host = s.replace(/^https?:\/\//i, "");
  return `https://${host}`;
}

async function fetchHtml(url: string, timeoutMs = 7000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Math.max(500, timeoutMs));
  try {
    const res = await F(url, { redirect: "follow", signal: ac.signal as any });
    const html = await res.text();
    return { ok: res.ok, status: res.status, url: res.url || url, html, headers: res.headers };
  } catch {
    return { ok: false, status: 0, url, html: "", headers: new Map() as any };
  } finally {
    clearTimeout(t);
  }
}

function rowFromSignals(host: string, s: ReturnType<typeof computeSignals>) {
  // Build tags deterministically from signals booleans
  const tags = new Set<string>();

  // stack (shopify, wordpress, wix, squarespace, woocommerce, bigcommerce)
  const st = s.stack || ({} as any);
  if (st.shopify) tags.add("shopify");
  if (st.wordpress) tags.add("wordpress");
  if (st.woocommerce) tags.add("woocommerce");
  if (st.wix) tags.add("wix");
  if (st.squarespace) tags.add("squarespace");
  if (st.bigcommerce) tags.add("bigcommerce");

  // pixels
  const px = s.pixels || ({} as any);
  if (px.ga4 || px.gtm) tags.add("ga4");
  if (px.ua) tags.add("ga-ua");
  if (px.meta) tags.add("meta");
  if (px.tiktok) tags.add("tiktok");
  if (px.linkedin) tags.add("linkedin");
  if (px.bing) tags.add("bing");

  // commerce & CTA
  if (s.commerce.hasCart || s.commerce.hasCheckout) tags.add("ecom");
  if (s.commerce.hasCheckout) tags.add("checkout");
  if (s.commerce.hasSku) tags.add("sku");
  if (s.commerce.hasPriceWord) tags.add("pricing");
  if (s.cta.hasQuote) tags.add("rfq");
  if (s.cta.hasBuy) tags.add("buy");
  if (s.cta.hasForm) tags.add("form");
  if (s.cta.hasPhone) tags.add("phone");
  if (s.cta.hasEmail) tags.add("email");

  // recency
  if (s.recency.hasUpdateWords) tags.add("launch");
  if (s.recency.hasRecentYear) tags.add(String(s.recency.recentYear));

  return {
    host,
    // no "platform" field in our Stack — keep tags only
    tags: Array.from(tags).slice(0, 24),
    segments: [],
  };
}

// ---- routes -------------------------------------------------------------

r.get("/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, at: new Date().toISOString() });
});

async function handleExplain(req: Request, res: Response) {
  try {
    const q = { ...req.query, ...(req.body || {}) } as Record<string, unknown>;
    const hostInput = String(q.host || "").trim();
    const adsOverride = q.ads != null ? Number(q.ads) : undefined;
    const urlInput = String(q.url || "").trim();

    const host = normHost(hostInput || urlInput);
    if (!host) return res.status(400).json({ ok: false, error: "host_required" });

    const url = toURL(urlInput || host);
    const t0 = Date.now();
    const fetched = await fetchHtml(url);
    const fetchMs = Date.now() - t0;

    const signals = computeSignals({
      html: fetched.html,
      url: fetched.url,
      headers: Object.create(null),
      adsActivity: Number.isFinite(adsOverride as number)
        ? Math.max(0, Math.min(1, adsOverride as number))
        : undefined,
    });

    const row = rowFromSignals(host, signals);
    const prefs = getPrefs(host);
    const scored = scoreRow(row as any, prefs as any, (prefs as any)?.city);
    const band = classifyScore(scored.score);

    res.json({
      ok: true,
      host,
      url: fetched.url,
      http: { ok: fetched.ok, status: fetched.status, ms: fetchMs, bytes: Buffer.byteLength(fetched.html, "utf8") },
      score: scored.score,
      band,
      reasons: scored.reasons,
      signals: summarizeSignals(signals),
      rowPreview: row,
      prefsSummary: {
        city: (prefs as any)?.city || null,
        likeTags: ((prefs as any)?.categoriesAllow || []).slice(0, 12),
        sectors: [], // sectors are inferred elsewhere; not part of EffectivePrefs
      },
      at: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "scores-explain-failed", detail: String(err?.message || err) });
  }
}

r.get("/explain", handleExplain);
r.post("/explain", handleExplain);

export default r;