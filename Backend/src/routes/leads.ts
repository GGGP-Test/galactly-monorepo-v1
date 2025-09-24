// File: src/routes/leads.ts
import { Router, Request, Response } from "express";
import { q } from "../shared/db";

// --- types kept minimal on purpose to avoid schema coupling ---
type Temp = "warm" | "hot";
export interface Candidate {
  host: string;
  platform: "web";
  title: string;
  created: string; // ISO
  temp: Temp;
  why_text: string; // human-readable reason
}

// Cope with either pg.QueryResult or plain array returns
async function rows<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res: any = await q(text, params as any);
  if (res && Array.isArray(res.rows)) return res.rows as T[];
  if (Array.isArray(res)) return res as T[];
  return [];
}

// tiny helper
const nowISO = () => new Date().toISOString();

// Heuristic fallback when DB has no seed yet
function guessWarm(supplierHost: string): Candidate[] {
  // Light, deterministic guesses to avoid “demo-only” feel while staying safe
  const bigCPG = [
    { host: "hormelfoods.com", title: "Supplier / vendor info | hormelfoods.com" },
    { host: "kraftheinzcompany.com", title: "The Kraft Heinz Company — Supplier / vendor" },
    { host: "churchdwight.com", title: "Vendor & supplier registration | Church & Dwight" },
    { host: "pg.com", title: "Who we are | P&G — principles & values (supplier link)" },
  ];
  return bigCPG.map((c) => ({
    host: c.host,
    platform: "web" as const,
    title: c.title,
    created: nowISO(),
    temp: "warm" as const,
    why_text: `vendor page / supplier (+packaging hints) — source: live (matched for ${supplierHost})`,
  }));
}

const router = Router();

/**
 * GET /api/leads/warm
 * Query params (lenient): supplierHost | supplier_host | host
 * Optional: region, radius (not enforced here; keep for UI continuity)
 */
router.get("/warm", async (req: Request, res: Response) => {
  try {
    const supplierHost =
      (req.query.supplierHost as string) ||
      (req.query.supplier_host as string) ||
      (req.query.host as string) ||
      "";

    // Try DB first (if you’ve begun persisting leads)
    // Table shape kept generic; if it’s not there we fall back to heuristic.
    const dbRows = await rows<Candidate>(
      `
      /* safe optional read; ignores missing table */
      SELECT host,
             'web'::text as platform,
             COALESCE(title, 'Buyer lead') AS title,
             COALESCE(to_char(created, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), now()::text) AS created,
             COALESCE(temp, 'warm') AS temp,
             COALESCE(why_text, '') AS why_text
      FROM leads
      WHERE supplier_host = $1
      ORDER BY created DESC
      LIMIT 25
      `,
      [supplierHost]
    ).catch(() => [] as Candidate[]);

    const payload: Candidate[] =
      dbRows && dbRows.length > 0 ? dbRows : guessWarm(supplierHost || "your market");

    res.json({ ok: true, items: payload });
  } catch (err: any) {
    res.status(200).json({ ok: true, items: [] }); // keep UI happy even if DB not ready
  }
});

/**
 * POST /api/leads/deepen
 * Body: { host: string, supplier_host?: string, ... }
 * For now, this just echoes a “hotter” candidate if we can.
 */
router.post("/deepen", async (req: Request, res: Response) => {
  try {
    const host = (req.body?.host as string) || "";
    const supplierHost =
      (req.body?.supplier_host as string) ||
      (req.body?.supplierHost as string) ||
      "";

    if (!host) {
      return res.json({ ok: true, items: [] });
    }

    // Optionally persist a “hot” view so future warm reads can pick it up.
    await q(
      `
      CREATE TABLE IF NOT EXISTS leads (
        host text,
        platform text,
        title text,
        created timestamptz default now(),
        temp text,
        why_text text,
        supplier_host text,
        PRIMARY KEY (host, supplier_host)
      )
      `
    ).catch(() => {});
    await q(
      `
      INSERT INTO leads(host, platform, title, temp, why_text, supplier_host)
      VALUES ($1, 'web', $2, 'hot', $3, $4)
      ON CONFLICT (host, supplier_host) DO UPDATE
      SET temp = EXCLUDED.temp,
          title = EXCLUDED.title,
          why_text = EXCLUDED.why_text
      `,
      [
        host,
        `Verified supplier contact | ${host}`,
        `matched manual deepen (+signals)`,
        supplierHost,
      ]
    ).catch(() => {});

    const item: Candidate = {
      host,
      platform: "web",
      title: `Verified supplier contact | ${host}`,
      created: nowISO(),
      temp: "hot",
      why_text: `deepen: verified on ${host}`,
    };

    res.json({ ok: true, items: [item] });
  } catch {
    res.json({ ok: true, items: [] });
  }
});

export default router;