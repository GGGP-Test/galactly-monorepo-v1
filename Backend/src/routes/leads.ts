import { Router, Request, Response } from "express";
import { pool } from "../shared/db";

type Temp = "cold" | "warm" | "hot";
type Candidate = {
  host: string;
  platform: "web";
  title: string;
  created: string; // ISO
  temp: Temp;
  why: string;
};

// --- simple per-session memory so Lock/Refresh works without DB ---
type SessionState = { latest?: Candidate; saved: Candidate[] };
const sessions = new Map<string, SessionState>();

const router = Router();

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asTemp(v: unknown, fallback: Temp): Temp {
  const t = asString(v).toLowerCase();
  return t === "hot" ? "hot" : t === "warm" ? "warm" : fallback;
}
function keyFor(req: Request): string {
  return (
    asString(req.header("x-key")) ||
    asString((req.query.key as string) || "") ||
    req.ip ||
    "anon"
  );
}
function ensureSession(k: string): SessionState {
  let s = sessions.get(k);
  if (!s) {
    s = { saved: [] };
    sessions.set(k, s);
  }
  return s;
}

// ------------------------------------------------------------------
// FIND BUYERS (still returns one deterministic example for now)
// ------------------------------------------------------------------
router.get("/find-buyers", async (req: Request, res: Response) => {
  const supplierHost = asString(req.query.host).toLowerCase().trim();
  const region = asString(req.query.region, "US/CA");
  const radius = asString(req.query.radius, "50mi");

  if (!supplierHost) {
    res.status(400).json({ ok: false, error: "query param 'host' is required" });
    return;
  }

  const now = new Date().toISOString();
  const item: Candidate = {
    host: "hormelfoods.com",
    platform: "web",
    title: "Supplier / vendor info | hormelfoods.com",
    created: now,
    temp: "warm",
    why: `Packaging-compatible buyer near ${region}; radius ${radius} for ${supplierHost}.`,
  };

  // remember latest for this session/key so Lock works
  const k = keyFor(req);
  const s = ensureSession(k);
  s.latest = item;

  // best-effort: persist "recent" (ignore if table missing)
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
    /* ignore */
  }

  res.json({ ok: true, items: [item] });
});

// ------------------------------------------------------------------
// LOCK latest (or explicit) candidate
// Supports GET for simplicity: /api/leads/lock?temp=warm
// Optional: host/title/why/created can be provided; otherwise uses latest.
// ------------------------------------------------------------------
async function doLock(req: Request, res: Response) {
  const k = keyFor(req);
  const s = ensureSession(k);

  // Build from query first, else use latest
  let host = asString(req.query.host);
  let title = asString(req.query.title);
  let why = asString(req.query.why);
  let created = asString(req.query.created);
  let temp: Temp = asTemp(req.query.temp, "warm");

  let cand: Candidate | undefined;

  if (host) {
    cand = {
      host,
      platform: "web",
      title: title || "Buyer",
      created: created || new Date().toISOString(),
      temp,
      why: why || "Locked by user",
    };
  } else if (s.latest) {
    cand = { ...s.latest, temp };
  }

  if (!cand) {
    res.status(400).json({ ok: false, error: "No candidate to lock." });
    return;
  }

  // Save in-memory
  s.saved.push(cand);

  // Best-effort DB persist
  try {
    await pool.query(
      `INSERT INTO saved_candidates (host, title, created, temp, why)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (host) DO UPDATE
         SET title = EXCLUDED.title,
             created = EXCLUDED.created,
             temp = EXCLUDED.temp,
             why = EXCLUDED.why`,
      [cand.host, cand.title, cand.created, cand.temp, cand.why]
    );
  } catch {
    /* ignore */
  }

  res.json({ ok: true, savedCount: s.saved.length, item: cand });
}

router.get("/lock", doLock);
// (If your frontend later switches to POST JSON, this handler still works
// because your app-level JSON parser will populate req.body. Kept GET for now.)

// ------------------------------------------------------------------
// LIST saved candidates (optionally filter by temp)
// ------------------------------------------------------------------
router.get("/list", (req: Request, res: Response) => {
  const k = keyFor(req);
  const s = ensureSession(k);
  const qTemp = asString(req.query.temp);
  const items =
    qTemp === "hot" || qTemp === "warm" || qTemp === "cold"
      ? s.saved.filter((x) => x.temp === (qTemp as Temp))
      : s.saved;
  res.json({ ok: true, items });
});

// ------------------------------------------------------------------
// CSV download of saved candidates
// ------------------------------------------------------------------
router.get("/csv", (req: Request, res: Response) => {
  const k = keyFor(req);
  const s = ensureSession(k);
  const qTemp = asString(req.query.temp);
  const rows =
    qTemp === "hot" || qTemp === "warm" || qTemp === "cold"
      ? s.saved.filter((x) => x.temp === (qTemp as Temp))
      : s.saved;

  const header = ["host", "platform", "title", "created", "temp", "why"];
  const lines = [header.join(",")].concat(
    rows.map((r) =>
      [
        r.host,
        r.platform,
        r.title.replace(/"/g, '""'),
        r.created,
        r.temp,
        r.why.replace(/"/g, '""'),
      ]
        .map((x) => `"${x}"`)
        .join(",")
    )
  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=leads.csv");
  res.send(lines.join("\n"));
});

export default router;