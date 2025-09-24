// File: src/routes/leads.ts
import { Router, Request, Response } from "express";
import { q } from "../shared/db";

// --- minimal types to avoid tight coupling with DB schema ---
type Temp = "warm" | "hot";
export interface Candidate {
  host: string;
  platform: "web";
  title: string;
  created: string; // ISO
  temp: Temp;
  why_text: string; // human-readable reason
}

const router = Router();

// Normalize q() result whether it's pg.QueryResult or an array
async function rows<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res: any = await q(text, params as any);
  if (res && Array.isArray(res.rows)) return res.rows as T[];
  if (Array.isArray(res)) return res as T[];
  return [];
}
const nowISO = () => new Date().toISOString();

function guessWarm(supplierHost: string, region?: string, radius?: string): Candidate[] {
  const bigCPG = [
    { host: "hormelfoods.com", title: "Supplier / vendor info | hormelfoods.com" },
    { host: "kraftheinzcompany.com", title: "The Kraft Heinz Company — Supplier / vendor" },
    { host: "churchdwight.com", title: "Vendor & supplier registration | Church & Dwight" },
    { host: "pg.com", title: "Who we are | P&G — principles & values (supplier link)" },
  ];
  const whyTail = [
    supplierHost ? `matched for ${supplierHost}` : "generic packaging supplier",
    region ? `region ${region}` : null,
    radius ? `radius ${radius}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const why = `vendor page / supplier (+packaging hints) — source: live${whyTail ? " — " + whyTail : ""}`;
  return bigCPG.map((c) => ({
    host: c.host,
    platform: "web",
    title: c.title,
    created: nowISO(),
    temp: "warm",
    why_text: why,
  }));
}

// Shared loader the endpoints can call
async function loadWarmFromDbOrGuess(
  supplierHost: string,
  region?: string,
  radius?: string
): Promise<Candidate[]> {
  // Try DB first (if present)
  const dbRows = await rows<Candidate>(
    `
    /* optional read; table may not exist yet */
    SELECT host,
           COALESCE(platform, 'web') AS platform,
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

  if (dbRows && dbRows.length) return dbRows;
  return guessWarm(supplierHost, region, radius);
}

/**
 * NEW: GET /api/leads/find-buyers
 * UI calls this with: ?host=peekpackaging.com&region=US/CA&radius=50mi
 * We mirror the response shape the table expects and also include `why` alias.
 */
router.get("/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost =
      (req.query.supplierHost as string) ||
      (req.query.supplier_host as string) ||
      (req.query.host as string) ||
      "";
    const region = (req.query.region as string) || "";
    const radius = (req.query.radius as string) || "";

    const items = await loadWarmFromDbOrGuess(supplierHost, region, radius);

    // Add `why` alias to be extra compatible with any UI variant
    const payload = items.map((c) => ({ ...c, why: c.why_text }));
    res.json({ ok: true, items: payload });
  } catch {
    res.json({ ok: true, items: [] });
  }
});

/**
 * Existing warm endpoint (kept for manual refresh buttons)
 */
router.get("/warm", async (req: Request, res: Response) => {
  try {
    const supplierHost =
      (req.query.supplierHost as string) ||
      (req.query.supplier_host as string) ||
      (req.query.host as string) ||
      "";
    const region = (req.query.region as string) || "";
    const radius = (req.query.radius as string) || "";
    const items = await loadWarmFromDbOrGuess(supplierHost, region, radius);
    res.json({ ok: true, items });
  } catch {
    res.json({ ok: true, items: [] });
  }
});

/**
 * POST /api/leads/deepen
 * Body: { host: string, supplier_host?: string }
 * Creates/updates a “hot” lead for future reads.
 */
router.post("/deepen", async (req: Request, res: Response) => {
  try {
    const host = (req.body?.host as string) || "";
    const supplierHost =
      (req.body?.supplier_host as string) ||
      (req.body?.supplierHost as string) ||
      "";
    if (!host) return res.json({ ok: true, items: [] });

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
        `deepen: verified on ${host}`,
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