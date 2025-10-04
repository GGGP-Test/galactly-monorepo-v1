// src/routes/tune.ts
import { Router, Request, Response } from "express";

// Adjust these imports to match your shared/score.ts exports
// Expected surface (simple & stable):
//   getWeights(): Record<string, number>
//   setWeights(w: Record<string, number>): Record<string, number>
//   defaultWeights(): Record<string, number>
//   autoTuneStep(opts: { sampleN?: number; alpha?: number; decay?: number; min?: number; max?: number }): {
//     ok: boolean; before: Record<string, number>; after: Record<string, number>; delta: number; used: number;
//   }
import {
  getWeights,
  setWeights,
  defaultWeights,
  autoTuneStep,
} from "../shared/score";

// Very small admin guard for this router (index.ts can apply a global one too)
function requireAdmin(req: Request, res: Response, next: Function) {
  const token = req.header("x-admin-token") || "";
  const allow = (process.env.TUNE_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "").trim();
  if (!allow || token !== allow) {
    return res.status(401).json({ ok: false, error: "admin_auth_required" });
  }
  return next();
}

export const TuneRouter = Router();
TuneRouter.use(requireAdmin);

// GET /api/tune/status  -> current weights + env knobs
TuneRouter.get("/status", (_req: Request, res: Response) => {
  try {
    const weights = getWeights();
    res.json({
      ok: true,
      enabled: process.env.TUNE_ENABLED === "1",
      auto: process.env.AUTO_TUNE_ENABLED === "1",
      cron: process.env.AUTO_TUNE_CRON || "",
      sampleN: Number(process.env.AUTO_TUNE_SAMPLE_N || 0) || 0,
      lr: Number(process.env.TUNE_LEARNING_RATE || 0) || 0,
      decay: Number(process.env.TUNE_DECAY || 0) || 0,
      min: Number(process.env.TUNE_MIN || -2),
      max: Number(process.env.TUNE_MAX || 2),
      weights,
    });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "tune-status-failed", detail: String(err?.message || err) });
  }
});

// POST /api/tune/weights { weights: {key: number} } -> set weights exactly
TuneRouter.post("/weights", (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as { weights?: Record<string, number> };
    const w = body.weights || {};
    const clamped: Record<string, number> = {};
    const lo = Number(process.env.TUNE_MIN || -2);
    const hi = Number(process.env.TUNE_MAX || 2);
    for (const [k, v] of Object.entries(w)) {
      const x = Number(v);
      if (!Number.isFinite(x)) continue;
      clamped[k] = Math.max(lo, Math.min(hi, x));
    }
    const after = setWeights(clamped);
    res.json({ ok: true, weights: after });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "tune-weights-failed", detail: String(err?.message || err) });
  }
});

// POST /api/tune/reset  -> restore defaults
TuneRouter.post("/reset", (_req: Request, res: Response) => {
  try {
    const after = setWeights(defaultWeights());
    res.json({ ok: true, reset: true, weights: after });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "tune-reset-failed", detail: String(err?.message || err) });
  }
});

// POST /api/tune/step { alpha?, decay?, sampleN? } -> run one auto-tune step
TuneRouter.post("/step", (req: Request, res: Response) => {
  try {
    if (process.env.TUNE_ENABLED !== "1") {
      return res.status(200).json({ ok: false, error: "tune_disabled" });
    }
    const alpha  = Number(req.body?.alpha  ?? process.env.TUNE_LEARNING_RATE ?? 0.08);
    const decay  = Number(req.body?.decay  ?? process.env.TUNE_DECAY ?? 0.98);
    const sampleN = Number(req.body?.sampleN ?? process.env.AUTO_TUNE_SAMPLE_N ?? 500);
    const min = Number(process.env.TUNE_MIN || -2);
    const max = Number(process.env.TUNE_MAX ||  2);

    const resStep = autoTuneStep({ sampleN, alpha, decay, min, max });
    res.json({ ok: true, ...resStep });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "tune-step-failed", detail: String(err?.message || err) });
  }
});

export default TuneRouter;