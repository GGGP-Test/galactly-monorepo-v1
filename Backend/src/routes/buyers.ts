// Backend/src/routes/buyers.ts
import express, { type Request, type Response, type Router, NextFunction } from "express";

type Persona = { offer?: string; solves?: string; titles?: string };
type FindBody = {
  supplier?: string;           // domain or name
  region?: string;             // "usca" etc.
  radiusMi?: number;
  persona?: Persona;
};

function readBody(req: Request): { ok: boolean; body?: Required<FindBody>; error?: string } {
  const b = (req.body ?? {}) as FindBody;
  const supplier = (b.supplier || b["domain"] || "").toString().trim();
  const region = (b.region || "usca").toString().toLowerCase();
  const radiusMi = Number(b.radiusMi ?? 50);
  const persona: Persona = {
    offer: (b.persona?.offer || "").toString(),
    solves: (b.persona?.solves || "").toString(),
    titles: (b.persona?.titles || "").toString(),
  };

  if (!supplier) return { ok: false, error: "domain is required" };
  if (!/^[a-z0-9.-]+$/i.test(supplier)) return { ok: false, error: "invalid domain" };
  if (!Number.isFinite(radiusMi) || radiusMi < 0) return { ok: false, error: "invalid radiusMi" };

  return { ok: true, body: { supplier, region, radiusMi, persona } as Required<FindBody> };
}

export default function mountBuyers(app: Router) {
  const r = express.Router();

  // simple per-router CORS safety (no .options call anywhere)
  r.use((req, res, next) => {
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // ensure JSON parse on this router
  r.use(express.json({ limit: "1mb" }));

  // POST /api/v1/leads/find-buyers
  r.post("/leads/find-buyers", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = readBody(req);
      if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

      // If you have a real discovery service, call it here:
      // const result = await discoverBuyers(parsed.body);
      // return res.json(result);

      // Temporary safe fallback so we never 500 while you iterate:
      const { supplier, region, radiusMi, persona } = parsed.body!;
      const empty = {
        ok: true,
        supplier: { domain: supplier, region, radiusMi },
        created: 0,
        hot: 0,
        warm: 0,
        candidates: [] as any[],
        note: "",
        message:
          "Created 0 candidate(s). Hot:0 Warm:0. (Either no matches or discovery was blocked.)",
      };
      return res.json(empty);
    } catch (err) {
      next(err);
    }
  });

  // mount at /api/v1
  app.use("/api/v1", r);
}