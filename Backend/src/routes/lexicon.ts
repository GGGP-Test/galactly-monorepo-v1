// src/routes/lexicon.ts
//
// Admin endpoints to manage the buyer-discovery lexicon.
// Mount in index.ts:  app.use("/api/lexicon", LexiconRouter)
//
// Routes
//  GET  /ping
//  GET  /preview?size=micro|small|medium|large
//  GET  /queries?size=...            -> current effective list
//  GET  /metrics                     -> lexicon telemetry summary
//  GET  /proposals                   -> list pending proposals
//  POST /propose   { items, size?, source?, by?, notes? }    [admin]
//  POST /promote   { id? } OR { size, items }                [admin]
//  POST /reject    { id }                                    [admin]
//  POST /clear-proposals                                     [admin]
//
// All responses are 200 with { ok: boolean, ... } for FE simplicity.

import { Router, Request, Response } from "express";
import { requireAdmin } from "../shared/admin";
import * as Lex from "../shared/lexicon";

export const LexiconRouter = Router();

type Size = Lex.Size;

function normSize(v?: string): Size | undefined {
  const s = String(v || "").trim().toLowerCase();
  if (s === "micro" || s === "small" || s === "medium" || s === "large") return s;
  return undefined;
}

function arr(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return (x as unknown[]).map(v => (v == null ? "" : String(v))).filter(Boolean);
}

LexiconRouter.get("/ping", (_req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

LexiconRouter.get("/preview", (_req: Request, res: Response) => {
  try {
    const size = normSize(String((_req.query as any)?.size || ""));
    const p = Lex.preview(size);
    res.json({ ok: true, size: size || null, ...p });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "lexicon-preview-failed", detail: String(e?.message || e) });
  }
});

LexiconRouter.get("/queries", (req: Request, res: Response) => {
  try {
    const size = normSize(String(req.query.size || ""));
    const items = Lex.getQueries({ size });
    res.json({ ok: true, size: size || null, count: items.length, items });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "lexicon-queries-failed", detail: String(e?.message || e) });
  }
});

LexiconRouter.get("/metrics", (_req: Request, res: Response) => {
  try {
    const m = Lex.metrics();
    res.json({ ok: true, metrics: m });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "lexicon-metrics-failed", detail: String(e?.message || e) });
  }
});

LexiconRouter.get("/proposals", (_req: Request, res: Response) => {
  try {
    const list = Lex.listProposals();
    res.json({ ok: true, total: list.length, items: list });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "lexicon-proposals-failed", detail: String(e?.message || e) });
  }
});

// Admin-only mutations -------------------------------------------------------

LexiconRouter.post("/propose", requireAdmin, (req: Request, res: Response) => {
  try {
    const size = normSize(req.body?.size) || "global";
    const items = arr(req.body?.items);
    const source = String(req.body?.source || "user") as "user" | "ai" | "system";
    const by = req.body?.by ? String(req.body.by) : undefined;
    const notes = req.body?.notes ? String(req.body.notes) : undefined;

    if (!items.length) return res.status(400).json({ ok: false, error: "items_required" });

    const p = Lex.propose({ items, size, source, by, notes });
    res.json({ ok: true, proposal: p });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "lexicon-propose-failed", detail: String(e?.message || e) });
  }
});

LexiconRouter.post("/promote", requireAdmin, (req: Request, res: Response) => {
  try {
    // promote by id (preferred) OR direct items+size
    if (req.body?.id) {
      const id = String(req.body.id);
      const result = Lex.promote({ id });
      return res.json({ ok: true, promoted: result });
    }
    const size = normSize(req.body?.size) || "global";
    const items = arr(req.body?.items);
    if (!items.length) return res.status(400).json({ ok: false, error: "items_required" });
    const result = Lex.promote({ size, items });
    return res.json({ ok: true, promoted: result });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "lexicon-promote-failed", detail: String(e?.message || e) });
  }
});

LexiconRouter.post("/reject", requireAdmin, (req: Request, res: Response) => {
  try {
    const id = String(req.body?.id || "");
    if (!id) return res.status(400).json({ ok: false, error: "id_required" });
    const result = Lex.reject(id);
    res.json({ ok: true, rejected: result });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "lexicon-reject-failed", detail: String(e?.message || e) });
  }
});

LexiconRouter.post("/clear-proposals", requireAdmin, (_req: Request, res: Response) => {
  try {
    const n = Lex.clearProposals();
    res.json({ ok: true, cleared: n });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "lexicon-clear-failed", detail: String(e?.message || e) });
  }
});

export default LexiconRouter;