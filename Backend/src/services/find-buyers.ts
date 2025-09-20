import type { Request, Response, NextFunction } from "express";

/** Minimal types that match what the Free Panel sends */
type PersonaInput = { offer?: string; solves?: string; titles?: string };
type FindBuyersInput = {
  supplier: string;
  region?: string;       // e.g. "usca"
  radiusMi?: number;     // e.g. 50
  onlyUSCA?: boolean;
  persona?: PersonaInput;
};

/** Shape the panel expects per row */
type UICandidate = {
  id: string;
  host: string;
  platform: string;   // keep as string; the UI just displays it
  title: string;
  created: string;    // ISO string
  temp: "hot" | "warm";
  why: string;
};

/** Utility: guard against hanging requests */
async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return await Promise.race<T>([
    p,
    new Promise<T>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

/** Generate safe, deterministic warm candidates so the panel shows results now. */
function makeDemoCandidates(supplier: string, n = 20): UICandidate[] {
  const now = new Date().toISOString();
  const base = supplier.replace(/^https?:\/\//, "").replace(/\/.*/, "");
  const host = base || "example.com";

  const titles = [
    "Purchasing Manager",
    "Procurement Lead",
    "Buyer",
    "Head of Ops",
    "Sourcing Manager",
  ];

  const rows: UICandidate[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `${host}#${i + 1}`,
      host,
      platform: "web",
      title: titles[i % titles.length],
      created: now,
      temp: "warm",
      why: `demo match for ${supplier}`,
    });
  }
  return rows;
}

/**
 * Single exported handler used by /api/v1/leads/find-buyers
 * Always responds; never leaves the request pending.
 */
export default async function findBuyers(
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const started = Date.now();
  const deadlineMs =
    Number(process.env.FIND_BUYERS_TIMEOUT_MS ?? 12000); // 12s guard

  try {
    // --- normalize input
    const body = (req.body ?? {}) as Partial<FindBuyersInput>;
    const supplier = String(body.supplier ?? "").trim().toLowerCase();
    const region = String(body.region ?? "usca").toLowerCase();
    const radiusMi = Number.isFinite(body.radiusMi) ? Number(body.radiusMi) : 50;
    const persona: PersonaInput = {
      offer: body.persona?.offer ?? "",
      solves: body.persona?.solves ?? "",
      titles: body.persona?.titles ?? "",
    };

    if (!supplier) {
      res.status(400).json({ error: "BAD_REQUEST", message: "supplier is required" });
      return;
    }

    // --- do the work (for now: fast deterministic demo data)
    const work = (async () => {
      // TODO: replace with real provider calls and scoring.
      const candidates = makeDemoCandidates(supplier, 20);

      const payload = {
        ok: true,
        tookMs: Date.now() - started,
        supplier,
        region,
        radiusMi,
        persona,
        created: candidates.length,
        hot: candidates.filter(c => c.temp === "hot").length,
        warm: candidates.filter(c => c.temp === "warm").length,
        candidates,
      };
      return payload;
    })();

    const result = await withDeadline(work, deadlineMs);

    if (!res.headersSent) res.status(200).json(result);
  } catch (err) {
    const msg = (err as Error)?.message ?? "unknown";
    if (!res.headersSent) {
      res.status(200).json({
        ok: true,
        tookMs: Date.now() - started,
        created: 0,
        hot: 0,
        warm: 0,
        candidates: [] as UICandidate[],
        note: `returned empty due to ${msg}`,
      });
    }
  }
}