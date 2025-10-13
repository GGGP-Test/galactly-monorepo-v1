// src/routes/scores.ts
//
// Signals → score → band explainer used by /api/web/find escalation.
// GET /api/scores/ping
// GET /api/scores/explain?host=acme.com
//
// Robust HTML fetch (https → www → http) + rescue heuristics when computeSignals is thin.

import { Router, type Request, type Response } from "express";
import { CFG } from "../shared/env";
import * as TRC from "../shared/trc";
import { computeSignals, summarizeSignals } from "../shared/signals";

const r = Router();
const F: (u: string, i?: any) => Promise<any> = (globalThis as any).fetch;

/* ------------------------------- helpers ---------------------------------- */

function normHost(raw?: string): string | undefined {
  if (!raw) return;
  const h = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9.-]+$/.test(h) ? h : undefined;
}

async function fetchText(url: string, timeoutMs: number): Promise<{ ok: boolean; text: string }> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), Math.max(1500, timeoutMs));
  try {
    const res = await F(url, {
      redirect: "follow",
      signal: ac.signal as any,
      headers: {
        // Some sites gate on UA/Accepts; keep this boring and “browsery”.
        "User-Agent": "Mozilla/5.0 (compatible; GalactlyScore/1.0; +https://galactly.example)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.7",
      }
    });
    if (!res?.ok) return { ok: false, text: "" };
    const txt = await res.text();
    return { ok: true, text: txt || "" };
  } catch {
    return { ok: false, text: "" };
  } finally {
    clearTimeout(to);
  }
}

/** Try https://host → https://www.host → http://host */
async function fetchSiteHtml(host: string, timeoutMs: number): Promise<{ url: string; html: string }> {
  const candidates = [
    `https://${host}`,
    `https://www.${host}`,
    `http://${host}`,
  ];
  for (const url of candidates) {
    const got = await fetchText(url, timeoutMs);
    if (got.ok && got.text && got.text.length > 128) return { url, html: got.text };
  }
  // last fallback: even short/empty still returned to keep pipeline flowing
  return { url: `https://${host}`, html: "" };
}

function clamp01(x: any): number { const v = Number(x); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }

function bandFromScore(score: number): "HOT" | "WARM" | "COOL" {
  const HOT_T  = Number((TRC as any)?.HOT_MIN  ?? 80);
  const WARM_T = Number((TRC as any)?.WARM_MIN ?? 55);
  if (typeof (TRC as any)?.classifyScore === "function") {
    try { return (TRC as any).classifyScore(score) as any; } catch { /* fall through */ }
  }
  return score >= HOT_T ? "HOT" : score >= WARM_T ? "WARM" : "COOL";
}

/* ----------------------- rescue signals (HTML-only) ------------------------ */
/** Extremely lightweight regex heuristics when computeSignals returns thin. */
function rescueSignals(html: string, url: string){
  const H = String(html || "");
  const has = (re: RegExp) => re.test(H);

  // Pixels
  const pixels = {
    ga4:       has(/\bgtag\(|google-analytics\.com\/g[a|t]ag/i) || has(/\bG-[A-Z0-9]{6,}\b/),
    gtm:       has(/\bgtm\.js\b/i) || has(/\bgoogletagmanager\.com\/gtm\.js/i),
    meta:      has(/\bfbq\(|facebook\.com\/tr\b/i),
    tiktok:    has(/\bttq\(|tiktok-analytics\b/i),
    linkedin:  has(/\linsight\.min\.js\b|\blpx\.ads\.linkedin\.com\b/i),
    bing:      has(/\buetq\(|bat\.bing\.com\/bat\.js\b/i),
  };

  // Stack fingerprints
  const stack = {
    shopify:     has(/\bcdn\.shopify\.com\b/i) || has(/\bShopify\b/i),
    bigcommerce: has(/\bbigcommerce\b|\bstencil-utils\b/i),
    woocommerce: has(/\bwoocommerce\b/i),
    wordpress:   has(/\bwp-content\b|\bwp-includes\b/i),
    wix:         has(/\bwixstatic\b|\bwixapps\b/i),
    squarespace: has(/\bsquarespace\.com\b/i),
  };

  // CTA & commerce
  const hasEmail  = has(/\bmailto:/i);
  const hasPhone  = has(/\btel:\+?\d/i) || has(/\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
  const hasForm   = has(/<form\b/i);
  const hasQuote  = has(/\bquote\b|\brfq\b|\brequest a quote\b/i);
  const hasBuy    = has(/\badd to cart\b|\bbuy now\b|\bcheckout\b/i);
  const ctaCount  = [hasEmail, hasPhone, hasForm, hasQuote, hasBuy].filter(Boolean).length;

  const commerce = {
    hasCart:      has(/\bcart\b/i),
    hasCheckout:  has(/\bcheckout\b/i),
    hasSku:       has(/\bsku\b/i),
    hasPriceWord: has(/\bprice|pricing|from \$\d+/i),
  };

  // Recency
  const yrMatch = H.match(/\b(20[1-3]\d)\b/);  // 2010–2039, generous
  const recentYear = yrMatch ? Number(yrMatch[1]) : 0;
  const hasUpdateWords = has(/\bnew\b|\bjust launched\b|\bnow available\b/i);

  // Pixel/ads intensity proxies (very rough)
  const pixelActivity = clamp01(
      (pixels.ga4?0.25:0) + (pixels.gtm?0.25:0) + (pixels.meta?0.2:0) +
      (pixels.tiktok?0.15:0) + (pixels.linkedin?0.1:0) + (pixels.bing?0.05:0)
  );
  const adsActivity = clamp01((pixels.meta?0.5:0) + (pixels.tiktok?0.3:0) + (pixels.linkedin?0.2:0));

  return {
    url,
    pixelActivity,
    adsActivity,
    pixels,
    stack,
    cta: { count: ctaCount, hasForm, hasEmail, hasPhone, hasQuote, hasBuy },
    commerce,
    recency: { hasUpdateWords, hasRecentYear: !!recentYear, recentYear },
  };
}

/* ------------------------------- scoring ---------------------------------- */

function scoreFromSignals(sig: any): { score: number; reasons: string[] } {
  let s = 50;
  const reasons: string[] = [];

  const pa = Number(sig.pixelActivity || 0);           // 0..1
  const aa = Number(sig.adsActivity || 0);             // 0..1
  if (pa > 0) { s += Math.min(18, Math.round(pa * 18)); reasons.push(`pixels:${pa.toFixed(2)}`); }
  if (aa > 0) { s += Math.min(12, Math.round(aa * 12)); reasons.push(`ads:${aa.toFixed(2)}`); }

  const c = sig.cta || {};
  const ctaCount = Number(c.count || 0);
  if (ctaCount > 0) { s += Math.min(16, ctaCount * 4); reasons.push(`cta:${ctaCount}`); }

  const com = sig.commerce || {};
  const knobs = ["hasCart","hasCheckout","hasSku","hasPriceWord"].filter(k => (com as any)[k]);
  if (knobs.length) { s += Math.min(14, knobs.length * 3); reasons.push(`commerce:${knobs.length}`); }

  const rec = sig.recency || {};
  if (rec.hasUpdateWords) { s += 3; reasons.push("recency:launch"); }
  if (rec.hasRecentYear)  { s += 2; reasons.push(`recency:${rec.recentYear}`); }

  s = Math.max(0, Math.min(100, s));
  return { score: s, reasons: Array.from(new Set(reasons)).slice(0, 12) };
}

/* -------------------------------- routes ---------------------------------- */

r.get("/ping", (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

r.get("/explain", async (req: Request, res: Response) => {
  try {
    const host = normHost(String(req.query.host || ""));
    if (!host) return res.status(400).json({ ok: false, error: "bad_host" });

    const timeoutMs = Math.max(4500, CFG.fetchTimeoutMs || 7000);

    // 1) Fetch HTML with fallbacks
    const got = await fetchSiteHtml(host, timeoutMs);
    const html = got.html || "";

    // 2) Primary extraction
    const sig0 = computeSignals({ html, url: got.url });

    // 3) Rescue if primary is thin (most zeros / undefined)
    const thin =
      !sig0 ||
      (!sig0.pixelActivity && !sig0.adsActivity &&
       !(sig0.cta && (sig0.cta.count || sig0.cta.hasEmail || sig0.cta.hasForm)) &&
       !(sig0.commerce && (sig0.commerce.hasCart || sig0.commerce.hasCheckout)));
    const rescue = thin ? rescueSignals(html, got.url) : null;

    // 4) Merge
    const sig = Object.assign({}, sig0 || {}, rescue || {});
    const { score, reasons } = scoreFromSignals(sig);
    const band = bandFromScore(score);

    return res.json({
      ok: true,
      host,
      score,
      band,
      reasons,
      signals: summarizeSignals(sig),
      fetchedFrom: got.url,
      at: new Date().toISOString(),
    });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "scores-explain-failed", detail: String(e?.message || e) });
  }
});

export default r;