// src/routes/feedback.ts
//
// Feedback API that teaches the persistent lexicon-store.
// Mount: app.use("/api/feedback", FeedbackRouter)
/* eslint-disable @typescript-eslint/no-var-requires */

import { Router, Request, Response } from "express";

// Tolerate missing store so builds stay green.
let Lex: any = null;
try { Lex = require("../shared/lexicon-store"); } catch { Lex = {}; }

const FeedbackRouter = Router();

/* ------------------------------ helpers ---------------------------------- */

function uniqLower(arr: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(arr)) {
    for (const v of arr) {
      const s = String(v ?? "").trim().toLowerCase();
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    }
  }
  return out.slice(0, 60);
}

function bool(v: unknown): boolean {
  return v === true || String(v).toLowerCase() === "true";
}

/* ------------------------------- routes ---------------------------------- */

FeedbackRouter.get("/ping", (_req, res) => {
  res.json({ pong: true, at: new Date().toISOString() });
});

// POST /api/feedback/learn
// Body accepts either:
//  { learned: { tags?:[], cities?:[], providers?:[] }, hostSeed?, source?, band?, plan? }
//  or a flat convenience form: { tags?:[], cities?:[], providers?:[] }
FeedbackRouter.post("/learn", (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as any;
    const learned = b.learned || b;

    const tags = uniqLower(learned?.tags);
    const cities = uniqLower(learned?.cities);
    const providers = uniqLower(learned?.providers);

    if (!tags.length && !cities.length && !providers.length) {
      return res.status(400).json({ ok: false, error: "nothing_to_learn" });
    }

    const payload = {
      source: String(b.source || "feedback"),
      hostSeed: String(b.hostSeed || ""),
      band: String(b.band || ""),
      plan: String(b.plan || ""),
      learned: { tags, cities, providers },
    };

    const fn = Lex?.recordLearn;
    if (typeof fn !== "function") {
      return res.status(501).json({ ok: false, error: "lexicon_store_unavailable" });
    }

    const result = fn(payload);
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "learn_failed", detail: String(e?.message || e) });
  }
});

// POST /api/feedback/thumb  { tags:[], up?:true, down?:true }
// Thumbs-up (or neutral) records as positive learning; thumbs-down ignores.
FeedbackRouter.post("/thumb", (req: Request, res: Response) => {
  try {
    const tags = uniqLower((req.body || {}).tags);
    const up = bool((req.body || {}).up);
    const down = bool((req.body || {}).down);

    if (!tags.length) return res.status(400).json({ ok: false, error: "tags_required" });

    // Only learn on up/neutral. Down = no-op (we avoid poisoning the store).
    if (!down) {
      const result = Lex?.recordLearn
        ? Lex.recordLearn({ source: "thumb", learned: { tags } })
        : null;
      return res.json({ ok: true, learned: { tags, up: !!up, down: !!down }, result });
    }
    return res.json({ ok: true, learned: { tags, up: false, down: true } });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "thumb_failed", detail: String(e?.message || e) });
  }
});

// GET /api/feedback/summary  -> tiny admin/debug summary of learned store
FeedbackRouter.get("/summary", (_req: Request, res: Response) => {
  try {
    const sum = typeof Lex?.summarize === "function" ? Lex.summarize() : null;
    if (!sum) return res.status(501).json({ ok: false, error: "lexicon_store_unavailable" });
    return res.json({ ok: true, ...sum });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "summary_failed", detail: String(e?.message || e) });
  }
});

// POST /api/feedback/promote  -> reserved for BV2 (not used in BV1)
FeedbackRouter.post("/promote", (_req: Request, res: Response) => {
  return res.status(501).json({ ok: false, error: "not_implemented_in_bv1" });
});

export default FeedbackRouter;