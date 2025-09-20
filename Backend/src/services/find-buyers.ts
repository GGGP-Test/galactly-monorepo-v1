import { Router, Request, Response } from "express";
import { runProviders } from "../providers";
import type { FindBuyersInput, Candidate } from "../providers/types";

const router = Router();

/** ---- tiny coercion helpers (no deps) ---- */
const asString = (v: unknown, d = ""): string =>
  Array.isArray(v) ? String(v[0] ?? d) : typeof v === "string" ? v : v == null ? d : String(v);

const asNumber = (v: unknown, d = 0): number => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : d;
};

const asCSVArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(x => asString(x).trim()).filter(Boolean);
  const s = asString(v).trim();
  if (!s) return [];
  return s.split(/[,;\n]/g).map(t => t.trim()).filter(Boolean);
};

/** POST /api/v1/leads/find-buyers */
router.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    // Body may come from form posts, fetch, etc. Normalize everything.
    const body = (req.body ?? {}) as Record<string, unknown>;

    const supplier = asString(body.supplier, "").toLowerCase();
    if (!supplier) {
      return res.status(400).json({ ok: false, error: "supplier (domain) is required" });
    }

    const region = asString(body.region, "usca").toLowerCase();
    const radiusMi = asNumber(body.radiusMi, 50);

    const personaRaw = (body.persona ?? {}) as Record<string, unknown>;
    const offer = asString(personaRaw.offer, "");
    const solves = asString(personaRaw.solves, "");

    // Providers expect titles: string[]  → turn "A, B, C" or ["A","B"] into string[]
    const titles = asCSVArray(personaRaw.titles);

    const input: FindBuyersInput = {
      supplier,
      region,
      radiusMi,
      persona: { offer, solves, titles }
    };

    const t0 = Date.now();
    const { candidates, meta } = await runProviders(input);

    const hot = candidates.filter((c: Candidate) => c.temp === "hot").length;
    const warm = candidates.filter((c: Candidate) => c.temp === "warm").length;

    return res.status(200).json({
      ok: true,
      created: candidates.length,
      candidates,
      meta: {
        ms: Date.now() - t0,
        hot,
        warm,
        ...meta
      }
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err || "unexpected error")
    });
  }
});

export default router;