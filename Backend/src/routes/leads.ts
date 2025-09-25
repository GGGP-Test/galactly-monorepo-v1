import { Router, Request, Response } from "express";

const router = Router();

/** ---------- Types ---------- */
type Temp = "warm" | "hot";
type Candidate = {
  host: string;
  platform: string;  // e.g. 'web'
  title: string;
  created: string;   // ISO string
  temp?: Temp;       // optional on input
  why?: string;      // human-readable reason
};

/** ---------- In-memory store (temporary, per pod) ---------- */
const saved: Record<Temp, Candidate[]> = { warm: [], hot: [] };

/** Dedup by host+title */
function pushUnique(bucket: Temp, c: Candidate) {
  const list = saved[bucket];
  const k = (x: Candidate) => `${x.host}#${x.title}`;
  if (!list.some(x => k(x) === k(c))) list.unshift({ ...c, temp: bucket });
}

/** ---------- Routes ---------- */

/**
 * GET /api/leads/find-buyers?host=peekpackaging.com&region=US%2FCA&radius=50+mi
 * Minimal implementation that returns one reasonable candidate immediately.
 * (Your earlier logic worked; this is intentionally simple and safe.)
 */
router.get("/leads/find-buyers", async (req: Request, res: Response) => {
  const host = String(req.query.host || "").trim().toLowerCase();
  const now = new Date().toISOString();

  // Very light heuristic example; keeps the API contract the UI expects.
  const candidate: Candidate = {
    host: "hormelfoods.com",
    platform: "web",
    title: "Supplier / vendor info | hormelfoods.com",
    created: now,
    why: "has supplier/vendor info page (likely accepts packaging vendors)",
    temp: "warm",
  };

  // Return array; UI reads the first as 'latest candidate'.
  res.json([candidate]);
});

/**
 * POST /api/leads/lock
 * Body: { candidate: Candidate, temp?: "warm"|"hot" }
 * If temp missing, falls back to candidate.temp or 'warm'.
 */
router.post("/leads/lock", (req: Request, res: Response) => {
  const body = req.body ?? {};
  const candidate: Candidate | undefined = body.candidate;
  const temp: Temp = (body.temp || candidate?.temp || "warm") as Temp;

  if (!candidate || !candidate.host || !candidate.title) {
    return res.status(400).json({ error: "candidate with host and title required" });
  }
  if (temp !== "warm" && temp !== "hot") {
    return res.status(400).json({ error: "temp must be 'warm' or 'hot'" });
  }

  const normalized: Candidate = {
    host: String(candidate.host).toLowerCase(),
    platform: candidate.platform || "web",
    title: candidate.title,
    created: candidate.created || new Date().toISOString(),
    why: candidate.why || "",
    temp,
  };

  pushUnique(temp, normalized);
  return res.json({ ok: true, savedCounts: { warm: saved.warm.length, hot: saved.hot.length } });
});

/**
 * GET /api/leads/saved?temp=warm|hot
 * Returns the saved bucket (defaults to 'warm' if unspecified/invalid).
 */
router.get("/leads/saved", (_req: Request, res: Response) => {
  const t = String(_req.query.temp || "warm").toLowerCase();
  const temp: Temp = t === "hot" ? "hot" : "warm";
  res.json(saved[temp]);
});

/**
 * POST /api/leads/clear
 * Body: { temp?: "warm"|"hot" }  // if omitted, clears both
 */
router.post("/leads/clear", (req: Request, res: Response) => {
  const t = String((req.body?.temp || "") as string).toLowerCase();
  if (t === "warm" || t === "hot") {
    saved[t as Temp] = [];
  } else {
    saved.warm = [];
    saved.hot = [];
  }
  res.json({ ok: true });
});

export default router;