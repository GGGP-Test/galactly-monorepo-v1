// src/routes/feedback.ts
//
// Thin feedback API that trains the shared lexicon from user clicks.
// Mount path: app.use("/api/feedback", FeedbackRouter)

import { Router, Request, Response } from "express";

// We tolerate missing file to keep builds green if someone deletes it.
let Lex: any = null;
try { Lex = require("../shared/lexicon"); } catch { Lex = {}; }

const FeedbackRouter = Router();

type ThumbBody = {
  host?: string;         // optional; for logs later
  tags?: string[];       // normalized tags like ["stretch wrap","rfq","shopify"]
  up?: boolean;          // true for thumbs-up
  down?: boolean;        // true for thumbs-down
};

// helper: normalize short arrays of strings
function normTags(v: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = String(x ?? "").trim().toLowerCase();
      if (s) out.push(s);
    }
  }
  // hard cap to keep it safe
  return Array.from(new Set(out)).slice(0, 24);
}

FeedbackRouter.get("/ping", (_req, res) => {
  res.json({ pong: true, at: new Date().toISOString() });
});

// POST /api/feedback/thumb { host?, tags:[], up?:true, down?:true }
FeedbackRouter.post("/thumb", (req: Request, res: Response) => {
  const body = (req.body || {}) as ThumbBody;
  const tags = normTags(body.tags);
  const up = !!body.up && !body.down;
  const down = !!body.down && !body.up;

  if (tags.length === 0) {
    return res.status(400).json({ ok: false, error: "tags_required" });
  }

  try {
    if (up && typeof Lex.onGoodResult === "function") Lex.onGoodResult(tags);
    if (down && typeof Lex.onBadResult === "function") Lex.onBadResult(tags);

    // If neither up nor down was set, treat as neutral “seen good”
    if (!up && !down && typeof Lex.onGoodResult === "function") Lex.onGoodResult(tags);

    return res.json({ ok: true, learned: { up, down, tags } });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "feedback-failed", detail: String(e?.message || e) });
  }
});

// POST /api/feedback/promote  -> fold winners from learn-bucket into core
FeedbackRouter.post("/promote", (_req: Request, res: Response) => {
  try {
    const fn = Lex?.promoteLearned;
    if (typeof fn !== "function") return res.status(501).json({ ok: false, error: "promote_unavailable" });
    const result = fn();
    return res.json({ ok: true, promoted: result || true });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "promote-failed", detail: String(e?.message || e) });
  }
});

export default FeedbackRouter;