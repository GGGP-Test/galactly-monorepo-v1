// src/routes/leads.ts
import { Router, Request, Response } from "express";
import { q, ensureSchema } from "../shared/db";

export type LeadRow = {
  id: number;
  host: string;
  platform: string | null;
  title: string | null;
  why_text: string | null;
  temp: string | null;
  created: string;
};

const leadsRouter = Router();

/** Make sure the table exists (no-op if already created). */
ensureSchema().catch((e) => {
  // don't crash the process on start; surface in logs
  console.error("[ensureSchema]", e);
});

/**
 * GET /api/leads/warm
 * Return recent leads we already have (what the panel expects after a find).
 */
leadsRouter.get("/warm", async (_req: Request, res: Response) => {
  const { rows } = await q<LeadRow>(
    `select id, host, platform, title, why_text, temp, created
       from leads
   order by created desc
      limit 200`
  );
  res.json({ ok: true, items: rows });
});

/**
 * POST /api/leads/save
 * Upsert a batch of leads coming from sweep/mirror/ingest.
 * Body shape: { items: Array<{host, platform?, title?, why_text?, temp?, created?}> }
 */
leadsRouter.post("/save", async (req: Request, res: Response) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  let saved = 0;
  for (const it of items) {
    const host: string | undefined = it?.host;
    if (!host) continue;

    await q(
      `insert into leads (host, platform, title, why_text, temp, created)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))
       on conflict do nothing`,
      [
        host,
        it.platform ?? null,
        it.title ?? null,
        // accept either why_text or whyText from different feeders
        it.why_text ?? it.whyText ?? null,
        it.temp ?? null,
        it.created ?? null,
      ]
    );
    saved++;
  }

  res.json({ ok: true, saved });
});

/**
 * GET /api/leads/find-buyers
 * Kick off discovery. For now, respond immediately (panel then calls /warm).
 * Your background sweep/mirror can still push into /save.
 */
leadsRouter.get("/find-buyers", async (_req: Request, res: Response) => {
  // no-op trigger for now — the panel only needs 200 OK quickly
  res.json({ ok: true, started: true });
});

/**
 * POST /api/leads/deepen
 * Placeholder that succeeds so the UI flow doesn't break.
 */
leadsRouter.post("/deepen", async (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/** Export in ALL the ways index.ts might import it. */
export default leadsRouter;
export { leadsRouter as router, leadsRouter as leads };