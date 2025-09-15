// Backend/src/routes/public.ts
import express, { type Router, type Request, type Response } from "express";

type LeadQuery = {
  temp?: string;   // "warm" | "hot" | etc.
  region?: string; // "usca" | ...
};

function readQuery(req: Request): { temp: string; region: string } {
  const q = req.query as LeadQuery;
  const temp = (q.temp || "warm").toString().toLowerCase();
  const region = (q.region || "usca").toString().toLowerCase();
  return { temp, region };
}

export default function mountPublic(app: Router) {
  const r = express.Router();

  // never use router.options; short-circuit preflights cleanly
  r.use((req, res, next) => {
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Lightweight public probe used by your panel & smoke tests
  // GET /leads?temp=warm&region=usca
  r.get("/leads", (req: Request, res: Response) => {
    const { temp, region } = readQuery(req);
    // This endpoint is intentionally “dumb” – it just proves the
    // service is up and echo-logs what the UI is asking for.
    const count = 0;
    console.log(`[public] GET /leads -> 200 temp=${temp} region=${region} count=${count}`);
    res.json({ ok: true, temp, region, count });
  });

  // mount at root (no .options anywhere)
  app.use("/", r);
}