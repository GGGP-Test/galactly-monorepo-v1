import { Router, Request, Response } from "express";
import { q } from "../shared/db";

type Temp = "warm" | "hot";

type Candidate = {
  host: string;
  platform: "web";
  title: string;
  created: string;  // ISO string
  temp: Temp;
  why: string;      // human-readable reason
};

const router = Router();

/**
 * Minimal, safe fallback catalog so the UI has a deterministic result
 * while we finish the real buyer-finding pipeline. This avoids any
 * scraping/hard deps and keeps the front end flowing.
 */
const curated: Omit<Candidate, "created">[] = [
  {
    host: "hormelfoods.com",
    platform: "web",
    title: "Supplier / vendor info | hormelfoods.com",
    temp: "warm",
    why: "vendor page / supplier registration — source: curated"
  },
  {
    host: "churchdwight.com",
    platform: "web",
    title: "Vendors | Church & Dwight",
    temp: "warm",
    why: "vendor page — source: curated"
  },
  {
    host: "kraftheinzcompany.com",
    platform: "web",
    title: "Suppliers | The Kraft Heinz Company",
    temp: "warm",
    why: "supplier page — source: curated"
  },
  {
    host: "pg.com",
    platform: "web",
    title: "P&G supplier principles and values",
    temp: "warm",
    why: "supplier page — source: curated"
  }
];

// Simple health for this router
router.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * GET /api/leads/find-buyers?host=peekpackaging.com&region=US%2FCA&radius=50+mi
 * Returns a compact list of Candidate objects. For now, we return one curated
 * warm candidate immediately so the UI stays fast and predictable.
 */
router.get("/find-buyers", async (req: Request, res: Response) => {
  // We accept these params to keep the contract stable
  const _host = String(req.query.host ?? "").toLowerCase().trim();
  const _region = String(req.query.region ?? "US").toUpperCase();
  const _radius = String(req.query.radius ?? "50 mi");

  const now = new Date().toISOString();
  const results: Candidate[] = [{ ...curated[0], created: now }];

  return res.json({ results });
});

/**
 * POST /api/leads/lock
 * Body: { candidate: Candidate, temp: "warm" | "hot" }
 * Persist the chosen candidate. Table is created idempotently if missing.
 */
router.post("/lock", async (req: Request, res: Response) => {
  const body = req.body as { candidate?: Candidate; temp?: Temp };

  if (!body?.candidate?.host) {
    return res.status(400).json({ error: "candidate.host required" });
  }

  const c = body.candidate;
  const chosenTemp: Temp = (body.temp ?? c.temp) as Temp;

  // Ensure table exists (no-op if it already does)
  await q`
    create table if not exists leads(
      id        serial primary key,
      host      text not null,
      platform  text not null,
      title     text not null,
      created   timestamptz not null default now(),
      temp      text not null,
      why       text not null
    )
  `;

  await q`
    insert into leads (host, platform, title, temp, why)
    values (${c.host}, ${c.platform}, ${c.title}, ${chosenTemp}, ${c.why})
  `;

  return res.json({ ok: true });
});

export default router;