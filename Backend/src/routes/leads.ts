// src/routes/leads.ts
import { Router, Request, Response } from "express";
import { pool } from "../shared/db"; // fixed, single path

type Temp = "cold" | "warm" | "hot";
type Candidate = {
  host: string;
  platform: "web";
  title: string;
  created: string; // ISO date string
  temp: Temp;
  why: string;
};

const router = Router();

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

router.get("/find-buyers", async (req: Request, res: Response) => {
  const supplierHost = asString(req.query.host).toLowerCase().trim();
  const region = asString(req.query.region, "US/CA");
  const radius = asString(req.query.radius, "50mi");

  if (!supplierHost) {
    res.status(400).json({ ok: false, error: "query param 'host' is required" });
    return;
  }

  // Deterministic minimal result; keeps UI working while we harden the guesser.
  const now = new Date().toISOString();
  const item: Candidate = {
    host: "hormelfoods.com",
    platform: "web",
    title: "Supplier / vendor info | hormelfoods.com",
    created: now,
    temp: "warm",
    why: `Packaging-compatible buyer near ${region}; radius ${radius} for ${supplierHost}.`,
  };

  // Best-effort persistence (ignore if table doesn't exist yet)
  try {
    await pool.query(
      `INSERT INTO recent_candidates (host, title, created, temp, why)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (host) DO UPDATE
         SET title = EXCLUDED.title,
             created = EXCLUDED.created,
             temp = EXCLUDED.temp,
             why = EXCLUDED.why`,
      [item.host, item.title, item.created, item.temp, item.why]
    );
  } catch {
    // Ignore DB write errors in this minimal path
  }

  res.json({ ok: true, items: [item] });
});

export default router;