// src/routes/lexicon.ts
//
// Read/learn/promote taxonomy terms exposed as an API.
// Public reads; writes are admin-only via x-admin-key (shared/admin).
//
// Endpoints:
//   GET  /api/lexicon/ping
//   GET  /api/lexicon                -> full snapshot (counts + lists)
//   POST /api/lexicon/learn          -> { kind, token } (admin)
//   POST /api/lexicon/promote        -> merge learned -> core (admin)
//
// Mount in index.ts (already optional):
//   const LexRoute = safeRequire("./routes/lexicon")?.default;
//   if (LexRoute) app.use("/api/lexicon", LexRoute);

import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../shared/admin";
import {
  getLexicon,
  addLearned,
  promoteLearned,
} from "../shared/lexicon";

const r = Router();

r.get("/ping", (_req: Request, res: Response) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

r.get("/", (_req: Request, res: Response) => {
  const lx = getLexicon();
  const counts = {
    verticalsSmall: lx.verticalsSmall.length,
    verticalsMidLarge: lx.verticalsMidLarge.length,
    productIntents: lx.productIntents.length,
    overlaysPersona: lx.overlaysPersona.length,
    queries: {
      micro: lx.queries.micro.length,
      small: lx.queries.small.length,
      medium: lx.queries.medium.length,
      large: lx.queries.large.length,
    },
  };
  res.json({ ok: true, counts, lexicon: lx });
});

r.post("/learn", requireAdmin, (req: Request, res: Response) => {
  try {
    const kind = String(req.body?.kind || "").trim();
    const token = String(req.body?.token || "").trim();
    if (!kind || !token) return res.status(400).json({ ok: false, error: "kind_and_token_required" });

    const ok = addLearned(kind as any, token);
    return res.json({ ok, kind, token });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "lexicon_learn_failed", detail: String(e?.message || e) });
  }
});

r.post("/promote", requireAdmin, (_req: Request, res: Response) => {
  try {
    promoteLearned();
    const lx = getLexicon();
    res.json({ ok: true, promoted: true, counts: {
      verticalsSmall: lx.verticalsSmall.length,
      verticalsMidLarge: lx.verticalsMidLarge.length,
      productIntents: lx.productIntents.length,
      overlaysPersona: lx.overlaysPersona.length,
      queries: {
        micro: lx.queries.micro.length,
        small: lx.queries.small.length,
        medium: lx.queries.medium.length,
        large: lx.queries.large.length,
      },
    }});
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "lexicon_promote_failed", detail: String(e?.message || e) });
  }
});

export default r;