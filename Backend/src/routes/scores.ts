// src/routes/scores.ts
//
// Signals → score → band explainer used by /api/web/find-buyers escalation.
// GET /api/scores/ping
// GET /api/scores/explain?host=acme.com
//
// Deterministic, no paid APIs. One-shot fetch of homepage HTML with timeout.

import { Router, type Request, type Response } from "express";
import { CFG } from "../shared/env";
import * as TRC from "../shared/trc";             // thresholds if present
import { computeSignals, summarizeSignals } from "../shared/signals";

const r = Router();
const F: (u: string, i?: any) => Promise<any> = (globalThis as any).fetch;

function normHost(raw?: string): string | undefined {
  if (!raw) return;
  const h = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9.-]+$/.test(h) ? h : undefined;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await F(url, { redirect: "follow", signal: ac.signal as any, headers: { "User-Agent": "scores/1.0" } });
    if (!res?.ok) return "";
    return await res.text();
  } catch { return ""; } finally { clearTimeout(t); }
}

function bandFromScore(score: number): "HOT" | "WARM" | "COOL" {
  const HOT_T  = Number((TRC as any)?.HOT_MIN  ?? 80);
  const WARM_T = Number((TRC as any)?.WARM_MIN ?? 55);
  if (typeof (TRC as any)?.classifyScore === "function") {
    try { return (TRC as any).classifyScore(score) as any; } catch { /* fall through */ }
  }
  return score >= HOT_T ? "HOT" : score >= WARM_T ? "WARM" : "COOL";
}

/** Heuristic scoring from signals (0..100), returns [score, reasons[]]. */
function scoreFromSignals(sig: ReturnType<typeof computeSignals>): { score: number; reasons: string[] } {
  let s = 50;
  const reasons: string[] = [];

  // Pixel/ads intensity
  const pa = Number(sig.pixelActivity || 0);           // 0..1
  const aa = Number(sig.adsActivity || 0);             // 0..1
  if (pa) { s += Math.min(18, Math.round(pa * 18)); reasons.push(`pixels:${pa.toFixed(2)}`); }
  if (aa) { s += Math.min(12, Math.round(aa * 12)); reasons.push(`ads:${aa.toFixed(2)}`); }

  // CTAs
  const c = sig.cta || ({} as any);
  const ctaCount = Number(c.count || 0);
  if (ctaCount) { s += Math.min(16, ctaCount * 4); reasons.push(`cta:${ctaCount}`); }

  // Commerce hints
  const com = sig.commerce || ({} as any);
  const knobs = ["hasCart","hasCheckout","hasSku","hasPriceWord"].filter(k => (com as any)[k]);
  if (knobs.length) { s += Math.min(14, knobs.length * 3); reasons.push(`commerce:${knobs.length}`); }

  // Recency
  const rec = sig.recency || ({} as any);
  if (rec.hasUpdateWords) { s += 3; reasons.push("recency:launch"); }
  if (rec.hasRecentYear)  { s += 2; reasons.push(`recency:${rec.recentYear}`); }

  s = Math.max(0, Math.min(100, s));
  return { score: s, reasons: Array.from(new Set(reasons)).slice(0, 12) };
}

r.get("/ping", (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

r.get("/explain", async (req: Request, res: Response) => {
  try {
    const host = normHost(String(req.query.host || ""));
    if (!host) return res.status(400).json({ ok: false, error: "bad_host" });

    const html = await fetchWithTimeout(`https://${host}`, Math.max(4000, CFG.fetchTimeoutMs || 7000));
    const sig = computeSignals({ html, url: `https://${host}` });
    const { score, reasons } = scoreFromSignals(sig);
    const band = bandFromScore(score);

    return res.json({
      ok: true,
      host,
      score,
      band,
      reasons,
      signals: summarizeSignals(sig),
      at: new Date().toISOString(),
    });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "scores-explain-failed", detail: String(e?.message || e) });
  }
});

export default r;