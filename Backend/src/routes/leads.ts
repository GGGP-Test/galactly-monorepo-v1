import { Router } from "express";
import { z } from "zod";

const router = Router();

// Optional API key guard. If no key set, it's a no-op (keeps local/dev easy).
router.use((req, res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need) return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
});

const FindBuyersReq = z.object({
  supplier: z.string().min(3, "supplier domain is required"),
  region: z.string().min(2).default("usca"),
  radiusMi: z.number().int().nonnegative().default(50),
  persona: z
    .object({
      offer: z.string().optional().default(""),
      solves: z.string().optional().default(""),
      titles: z.string().optional().default("")
    })
    .optional()
    .default({ offer: "", solves: "", titles: "" }),
  onlyUSCA: z.boolean().optional().default(true)
});

type Candidate = { name: string; website?: string; reason?: string; score?: number };

router.post("/find-buyers", async (req, res) => {
  const parsed = FindBuyersReq.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }
  const { supplier, region, radiusMi, persona } = parsed.data;

  // --- discovery engine hook ---
  const { candidates, note } = await discoverBuyers({ supplier, region, radiusMi, persona });

  const created = candidates.length;
  const hot = candidates.filter(c => (c.score ?? 0) >= 80).length;
  const warm = candidates.filter(c => (c.score ?? 0) >= 50 && (c.score ?? 0) < 80).length;

  return res.json({
    ok: true,
    supplier: { domain: supplier, region, radiusMi },
    created,
    hot,
    warm,
    candidates,
    note: note || "",
    message:
      created > 0
        ? `Created ${created} candidate(s). Hot:${hot} Warm:${warm}.`
        : "Created 0 candidate(s). Hot:0 Warm:0. (Either no matches or discovery was blocked.)"
  });
});

// Minimal placeholder “engine” so the API never 500s.
// By default it returns EMPTY (so smoke will surface real gaps).
// If you set env SMOKE_FAKE_MIN=3, it emits 3 deterministic fakes for CI while you iterate.
async function discoverBuyers(input: {
  supplier: string;
  region: string;
  radiusMi: number;
  persona?: { offer?: string; solves?: string; titles?: string };
}): Promise<{ candidates: Candidate[]; note?: string }> {
  const min = Number(process.env.SMOKE_FAKE_MIN || "0");
  if (min > 0) {
    const root = input.supplier.replace(/^www\./, "");
    const mk = (i: number): Candidate => ({
      name: `${root} prospect ${i}`,
      website: `https://example${i}.${root}`,
      reason: input.persona?.offer ? `Matches offer: ${input.persona.offer}` : "Smoke sample",
      score: 50 + i * 10
    });
    return { candidates: Array.from({ length: min }, (_, i) => mk(i + 1)), note: "FAKE: SMOKE_FAKE_MIN" };
  }
  // TODO: plug your real discovery here (Google/OPAL/Serp/OpenSearch/etc)
  return { candidates: [] };
}

export default router;