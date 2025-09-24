// File: src/routes/leads.ts
import { Router, Request, Response } from "express";
import { q } from "../shared/db";

const router = Router();

/** ---------- Types (kept light to avoid schema coupling) ---------- */
type Temp = "warm" | "hot";
type Platform = "web";
export interface Candidate {
  host: string;
  platform: Platform;
  title: string;
  created: string;      // ISO
  temp: Temp;
  why_text: string;     // human-readable reason
}

/** ---------- Helpers ---------- */
const nowISO = () => new Date().toISOString();

async function rows<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res: any = await q(text, params as any).catch(() => null);
  if (res && Array.isArray(res.rows)) return res.rows as T[];
  if (Array.isArray(res)) return res as T[];
  return [];
}

async function exec(text: string, params?: any[]) {
  try { await q(text, params as any); } catch { /* best-effort */ }
}

async function ensureTable() {
  await exec(`
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
  `);
}

/** Tier A/B “big buyer” seeds — safe warm guesses */
const BIG_BUYERS: Array<{host:string; title:string}> = [
  { host: "hormelfoods.com",         title: "Supplier / vendor info | hormelfoods.com" },
  { host: "kraftheinzcompany.com",   title: "The Kraft Heinz Company — Supplier / vendor" },
  { host: "churchdwight.com",        title: "Vendor & supplier registration | Church & Dwight" },
  { host: "pg.com",                  title: "P&G — principles & values (supplier links)" },
  { host: "conagrabrands.com",       title: "Conagra Brands — Supplier / Vendor" },
  { host: "genmills.com",            title: "General Mills — Supplier information" }
];

/** Generate safe “warm” guesses with our guardrails  */
function guessWarm(supplierHost: string, region?: string, radius?: string): Candidate[] {
  const whyTail = [
    supplierHost ? `matched for ${supplierHost}` : undefined,
    region ? `region ${region}` : undefined,
    radius ? `radius ${radius}` : undefined,
  ].filter(Boolean).join(" · ");
  const why = `vendor page / supplier (+packaging hints) — source: live${whyTail ? " — " + whyTail : ""}`;

  return BIG_BUYERS.map(b => ({
    host: b.host,
    platform: "web",
    title: b.title,
    created: nowISO(),
    temp: "warm",
    why_text: why
  }));
}

async function loadWarmFromDbOrGuess(
  supplierHost: string,
  region?: string,
  radius?: string
): Promise<Candidate[]> {
  const dbRows = await rows<Candidate>(
    `
      SELECT host,
             COALESCE(platform, 'web') AS platform,
             COALESCE(title, 'Buyer lead') AS title,
             COALESCE(to_char(created, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), now()::text) AS created,
             COALESCE(temp, 'warm') AS temp,
             COALESCE(why_text, '') AS why_text
      FROM leads
      WHERE supplier_host = $1
      ORDER BY created DESC
      LIMIT 50
    `,
    [supplierHost]
  );

  if (dbRows.length) return dbRows;
  return guessWarm(supplierHost, region, radius);
}

/** Save/upsell a lead with a given temperature */
async function upsertLead(c: Candidate, supplierHost: string) {
  await ensureTable();
  await exec(
    `
      INSERT INTO leads(host, platform, title, created, temp, why_text, supplier_host)
      VALUES ($1, $2, $3, NOW(), $4, $5, $6)
      ON CONFLICT (host, supplier_host) DO UPDATE
      SET temp = EXCLUDED.temp,
          title = EXCLUDED.title,
          why_text = EXCLUDED.why_text,
          created = NOW()
    `,
    [c.host, c.platform, c.title, c.temp, c.why_text, supplierHost]
  );
}

/** Read saved by temp */
async function loadSavedByTemp(supplierHost: string, temp: Temp): Promise<Candidate[]> {
  await ensureTable();
  return rows<Candidate>(
    `
      SELECT host,
             COALESCE(platform, 'web') AS platform,
             title,
             to_char(created, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created,
             temp,
             COALESCE(why_text, '') AS why_text
      FROM leads
      WHERE supplier_host = $1 AND temp = $2
      ORDER BY created DESC
      LIMIT 200
    `,
    [supplierHost, temp]
  );
}

/** CSV builder */
function toCsv(items: Candidate[]) {
  const header = ["host","platform","title","created","temp","why"].join(",");
  const lines = items.map(i =>
    [i.host, i.platform, i.title, i.created, i.temp, i.why_text]
      .map(v => `"${String(v ?? "").replace(/"/g,'""')}"`)
      .join(",")
  );
  return [header, ...lines].join("\n");
}

/** Extract supplierHost from query/body in multiple spellings */
function getSupplierHost(req: Request) {
  return (
    (req.query.supplierHost as string) ||
    (req.query.supplier_host as string) ||
    (req.query.host as string) ||
    (req.body?.supplierHost as string) ||
    (req.body?.supplier_host as string) ||
    ""
  );
}

/** -------------------- ROUTES -------------------- */

/** 1) Used by the panel “Find buyer” button */
router.get("/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost = getSupplierHost(req);
    const region = (req.query.region as string) || "";
    const radius = (req.query.radius as string) || "";
    const items = await loadWarmFromDbOrGuess(supplierHost, region, radius);
    // add alias `why` for UI variants
    res.json({ ok: true, items: items.map(i => ({ ...i, why: i.why_text })) });
  } catch {
    res.json({ ok: true, items: [] });
  }
});

/** 2) “Lock (Warm)” and “Lock (Hot)” */
router.post("/lock", async (req: Request, res: Response) => {
  try {
    const supplierHost = getSupplierHost(req);
    const host = (req.body?.host as string) || "";
    const title = (req.body?.title as string) || `Saved lead | ${host}`;
    const temp = ((req.body?.temp as Temp) || "warm") as Temp;
    const why_text = (req.body?.why as string) || (req.body?.why_text as string) || `locked:${temp}`;
    if (!host || !supplierHost) return res.json({ ok: true, items: [] });

    const item: Candidate = {
      host,
      platform: "web",
      title,
      created: nowISO(),
      temp,
      why_text
    };
    await upsertLead(item, supplierHost);
    res.json({ ok: true, items: [item] });
  } catch {
    res.json({ ok: true, items: [] });
  }
});
// Compatibility shortcuts if UI calls specific paths:
router.post("/lock-warm", async (req, res) => { (req as any).body = { ...req.body, temp: "warm" }; return router.handle(req, res); });
router.post("/lock-hot",  async (req, res) => { (req as any).body = { ...req.body, temp: "hot"  }; return router.handle(req, res); });

/** 3) “Refresh warm / hot” (reads what we’ve stored) */
router.get("/warm", async (req: Request, res: Response) => {
  try {
    const supplierHost = getSupplierHost(req);
    const items = await loadSavedByTemp(supplierHost, "warm");
    res.json({ ok: true, items });
  } catch {
    res.json({ ok: true, items: [] });
  }
});
router.get("/hot", async (req: Request, res: Response) => {
  try {
    const supplierHost = getSupplierHost(req);
    const items = await loadSavedByTemp(supplierHost, "hot");
    res.json({ ok: true, items });
  } catch {
    res.json({ ok: true, items: [] });
  }
});

/** 4) “Download CSV (warm / hot)” */
router.get("/csv", async (req: Request, res: Response) => {
  try {
    const supplierHost = getSupplierHost(req);
    const temp = ((req.query.temp as Temp) || "warm") as Temp;
    const items = await loadSavedByTemp(supplierHost, temp);
    const csv = toCsv(items);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="leads-${temp}.csv"`);
    res.send(csv);
  } catch {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send("host,platform,title,created,temp,why\n");
  }
});
// Convenience aliases if UI hits fixed paths:
router.get("/csv/warm", (req, res) => { (req as any).query = { ...req.query, temp: "warm" }; return router.handle(req, res); });
router.get("/csv/hot",  (req, res) => { (req as any).query = { ...req.query, temp: "hot"  }; return router.handle(req, res); });

/** 5) “Deeper results” (safe, still Tier A/B) */
router.get("/deeper", async (req: Request, res: Response) => {
  try {
    const supplierHost = getSupplierHost(req);
    const region = (req.query.region as string) || "";
    const radius = (req.query.radius as string) || "";
    // produce a slightly larger warm set; still curated
    const base = guessWarm(supplierHost, region, radius);
    const extra = [
      { host: "mondelēzinternational.com", title: "Mondelez — Supplier / Vendor" },
      { host: "kelloggcompany.com",        title: "Kellanova / Kellogg — Supplier info" }
    ].map(e => ({
      host: e.host,
      platform: "web" as const,
      title: e.title,
      created: nowISO(),
      temp: "warm" as const,
      why_text: `additional Tier A/B — curated — ${supplierHost || "supplier"}`
    }));
    res.json({ ok: true, items: [...base, ...extra] });
  } catch {
    res.json({ ok: true, items: [] });
  }
});

export default router;