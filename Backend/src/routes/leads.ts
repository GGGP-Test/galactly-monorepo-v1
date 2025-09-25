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

// in-memory per-session store (keyed by x-key header or IP)
type SessionState = { latest?: Candidate; saved: Candidate[] };
const sessions = new Map<string, SessionState>();

const router = Router();

// ---------- helpers ----------
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
// read a parameter from body first, then query
function param(req: Request, name: string): string {
  const fromBody = (req.body && (req.body as any)[name]) as unknown;
  if (typeof fromBody === "string") return fromBody;
  const fromQuery = (req.query as any)[name] as unknown;
  return asString(fromQuery);
}

// ---------- routes ----------

// /api/leads/find-buyers  (simple deterministic example for now)
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

  // best-effort DB persist to recent_candidates
  try {
    await pool.query(
      `INSERT INTO recent_candidates (host, title, created, temp, why)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (host) DO UPDATE
         SET title=EXCLUDED.title, created=EXCLUDED.created,
             temp=EXCLUDED.temp, why=EXCLUDED.why`,
      [item.host, item.title, item.created, item.temp, item.why]
    );
  } catch {
    /* ignore if table not present */
  }

  res.json({ ok: true, items: [item] });
});

// Lock latest (or explicit) candidate
async function doLock(req: Request, res: Response) {
  const k = keyFor(req);
  const s = ensureSession(k);

  // Prefer body, then query
  let host = param(req, "host");
  let title = param(req, "title");
  let why = param(req, "why");
  let created = param(req, "created");
  let temp: Temp = asTemp(param(req, "temp"), "warm");

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

  // save in memory
  s.saved.push(cand);

  // best-effort DB persist to saved_candidates
  try {
    await pool.query(
      `INSERT INTO saved_candidates (host, title, created, temp, why)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (host) DO UPDATE
         SET title=EXCLUDED.title, created=EXCLUDED.created,
             temp=EXCLUDED.temp, why=EXCLUDED.why`,
      [cand.host, cand.title, cand.created, cand.temp, cand.why]
    );
  } catch {
    /* ignore if table not present */
  }

  res.status(200).json({ ok: true, savedCount: s.saved.length, item: cand });
}

router.post("/lock", doLock); // <— added POST to fix 404 from UI
router.get("/lock", doLock);

// List saved (optionally filter by temp)
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

// CSV download
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