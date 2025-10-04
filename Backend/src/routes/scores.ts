// src/routes/scores.ts
//
// Explainable scoring for a single host.
// - GET  /api/scores/ping
// - GET  /api/scores/explain?host=acme.com
//        (optional) &ads=0..1  -> override adsActivity [0..1]
//        (optional) &url=...   -> override fetch URL
// - POST /api/scores/explain { host, ads?, url? }
//
// What it does (no external deps):
//   1) fetches one page (homepage unless ?url= supplied) with timeout
//   2) runs tech + signals extraction (pixels, stack, CTA, pricing, cart, recency)
//   3) builds a lightweight "row" view from those signals
//   4) fetches prefs for the host and scores the row via trc.scoreRow()
//   5) returns score, band, reasons + a signals summary for debugging
//
// NOTE: this route is read-only and safe; it does not modify prefs or stores.

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
  } catch (e) {
    return { ok: false, status: 0, url, html: "", headers: new Map() as any };
  } finally {
    clearTimeout(t);
  }
}

function rowFromSignals(host: string, s: ReturnType<typeof computeSignals>) {
  // Tags derived from signals (kept simple & deterministic)
  const tags = new Set<string>();

  // platform + stack
  if (s.stack?.platform) tags.add(String(s.stack.platform).toLowerCase()); // e.g., shopify, wordpress
  if (Array.isArray(s.stack?.techs)) for (const t of s.stack.techs) tags.add(String(t).toLowerCase());

  // pixels
  if (Array.isArray(s.pixels?.names)) for (const p of s.pixels.names) tags.add(String(p).toLowerCase());

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

  // assemble a minimal "row" the scorer understands
  return {
    host,
    platform: s.stack?.platform || undefined,
    tags: Array.from(tags).slice(0, 24),
    segments: [], // we’re not inferring verticals here (kept to signals only)
    // leave size/revenue/employees undefined (the scorer treats them as optional)
  };
}

// ---- routes -------------------------------------------------------------

r.get("/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, at: new Date().toISOString() });
});

async function handleExplain(req: Request, res: Response) {
  try {
    // inputs (query or body)
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

    // compute signals (optionally pass adsActivity override)
    const signals = computeSignals({
      html: fetched.html,
      url: fetched.url,
      headers: Object.create(null), // we don’t rely on headers today
      adsActivity: Number.isFinite(adsOverride as number) ? Math.max(0, Math.min(1, adsOverride as number)) : undefined,
    });

    const row = rowFromSignals(host, signals);
    const prefs = getPrefs(host);

    const scored = scoreRow(row as any, prefs as any, prefs?.targeting?.city);
    const band = classifyScore(scored.score);

    const out = {
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
        city: prefs?.targeting?.city || null,
        likeTags: (prefs?.likeTags || prefs?.productTags || []).slice(0, 12),
        sectors: (prefs?.sectorHints || []).slice(0, 6),
      },
      at: new Date().toISOString(),
    };

    res.json(out);
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "scores-explain-failed", detail: String(err?.message || err) });
  }
}

r.get("/explain", handleExplain);
r.post("/explain", handleExplain);

export default r;