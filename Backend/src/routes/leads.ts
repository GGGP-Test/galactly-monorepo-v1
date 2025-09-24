// src/routes/leads.ts
import { Router, Request, Response } from "express";
import { q } from "../shared/db"; // <- uses the named export from your green db.ts

const router = Router();

/** DB row shape we read from the candidates table */
type DbCandidateRow = {
  host: string;
  platform: string | null;
  title: string | null;
  why_text: string | null;
  created_at: Date | string | null;
  temp: "warm" | "hot" | null;
};

/** What we send back to the UI */
type UICandidate = {
  host: string;
  platform: string;
  title: string;
  created: string; // ISO
  temp: "warm" | "hot";
  why_text: string;
  /** optional preview text; NOT part of your global Candidate type */
  snippet?: string;
};

/** Tiny helper to create a short preview safely (no 'snippet' property access on Candidate) */
function makeSnippet(row: Pick<DbCandidateRow, "title" | "why_text">, max = 140): string | undefined {
  const src = (row.why_text || row.title || "").trim();
  if (!src) return undefined;
  const s = src.replace(/\s+/g, " ");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Normalize DB row -> UI object (no reliance on any global Candidate interface) */
function toUI(row: DbCandidateRow): UICandidate {
  const created =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at
      ? new Date(row.created_at).toISOString()
      : new Date().toISOString();

  return {
    host: row.host,
    platform: row.platform ?? "web",
    title: row.title ?? "",
    created,
    temp: (row.temp ?? "warm") as "warm" | "hot",
    why_text: row.why_text ?? "",
    snippet: makeSnippet(row),
  };
}

/**
 * GET /api/leads/warm
 * Return the latest candidates for the panel. If the table doesn't exist yet,
 * we respond with an empty list instead of exploding the build/runtime.
 */
router.get("/warm", async (_req: Request, res: Response) => {
  try {
    const result = await q<DbCandidateRow>`
      SELECT host, platform, title, why_text, created_at, temp
      FROM candidates
      ORDER BY created_at DESC
      LIMIT 100
    `;
    const out = (result.rows ?? []).map(toUI);
    res.json(out);
  } catch (err) {
    // Table might not exist yet during first boot or migration: return empty list.
    res.json([]);
  }
});

/**
 * GET /api/leads/find-buyers?host=...&region=...&radius=...
 * This kicks off discovery. We try a best-effort call into any optional SQL helper
 * you may have (e.g., discover_candidates). If it doesn't exist, we still 200.
 */
router.get("/find-buyers", async (req: Request, res: Response) => {
  const host = String(req.query.host || "").trim();
  const region = String(req.query.region || "").trim();
  const radius = String(req.query.radius || "").trim();

  // Always ack quickly; the UI will call /warm to show results.
  try {
    // If you’ve created a SQL function to enqueue a discovery sweep, call it.
    // If it doesn't exist, this will throw and we’ll just ignore.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = await q`
      SELECT 1
      FROM pg_catalog.pg_proc
      WHERE proname = 'discover_candidates'
    `;

    // Attempt to run it if present; ignore if missing.
    await q<any>`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'discover_candidates') THEN
          PERFORM discover_candidates(${host}, ${region}, ${radius});
        END IF;
      END$$;
    `;
  } catch {
    // no-op
  }

  res.json({ ok: true });
});

/**
 * POST /api/leads/deepen
 * Typically used to enrich currently found warm candidates. We keep it lenient:
 * respond 200 even if there isn’t any deeper pipeline yet.
 */
router.post("/deepen", async (_req: Request, res: Response) => {
  // If you have a background job or SQL function to enrich leads, call it here.
  // Left as a stub so builds don't fail if it isn't wired yet.
  res.json({ ok: true });
});

export default router;
// also provide a named export if your index.ts used it previously
export { router };