import { Request, Response } from "express";
import seeds from "../data/seed-buyers.json";

type Persona = {
  offer?: string;
  solves?: string;
  titles?: string;
};

type SupplierInput = {
  supplier?: string;
  region?: string;     // "us", "ca", "usca"
  radiusMi?: number;
  persona?: Persona;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

type Candidate = {
  id: string;
  company: string;
  website: string;
  host: string;
  title: string;
  score: number; // 0..1
  why: string;
  contact?: string;
  email?: string;
};

type ResponsePayload = {
  created: number;
  candidates: Candidate[];
  inferred?: { supplier?: string; region?: string; radiusMi?: number };
  note?: string;
};

type Seed = {
  id: string;
  company: string;
  website: string;
  titles: string[];
  regions: string[];
  tags: string[];
};

function hostOf(url: string): string {
  try { return new URL(url).host || ""; } catch { return ""; }
}

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s,/#&+-]/g, " ")
    .split(/[\s,/#&+-]+/)
    .filter(Boolean);
}

function regionFilter(userRegion?: string) {
  const r = (userRegion || "").toLowerCase();
  if (!r) return (_s: Seed) => true;
  const wantUS = r.includes("us");
  const wantCA = r.includes("ca");
  return (s: Seed) => {
    const hasUS = s.regions.some((x) => x.includes("us"));
    const hasCA = s.regions.some((x) => x.includes("ca"));
    if (wantUS && wantCA) return hasUS || hasCA;
    if (wantUS) return hasUS;
    if (wantCA) return hasCA;
    return true;
  };
}

function scoreSeed(seed: Seed, persona?: Persona): { score: number; why: string } {
  const offerT = tokenize(persona?.offer || "");
  const solvesT = tokenize(persona?.solves || "");
  const titlesT = tokenize(persona?.titles || "");
  const want = new Set([...offerT, ...solvesT, ...titlesT]);

  const hay = new Set<string>([
    ...seed.tags.map((t) => t.toLowerCase()),
    ...seed.titles.map((t) => t.toLowerCase()),
  ]);

  let hits = 0;
  for (const w of want) if (hay.has(w)) hits++;

  let titleHits = 0;
  const seedTitles = seed.titles.map((x) => x.toLowerCase());
  for (const t of titlesT) if (seedTitles.includes(t)) titleHits++;

  const denom = Math.max(1, want.size);
  const raw = hits / denom;
  const boost = Math.min(0.3, titleHits * 0.1);
  const score = Math.max(0, Math.min(1, raw + boost));

  const whyParts: string[] = [];
  if (titleHits > 0) whyParts.push(`matched titles: ${titleHits}`);
  if (hits - titleHits > 0) whyParts.push(`matched tags: ${hits - titleHits}`);
  if (whyParts.length === 0) whyParts.push("baseline relevance");

  return { score, why: whyParts.join(", ") };
}

export default async function findBuyers(
  req: Request<unknown, unknown, SupplierInput>,
  res: Response
) {
  const body = req.body ?? {};
  const supplier =
    (typeof body.supplier === "string" && body.supplier.trim()) || undefined;
  const region = typeof body.region === "string" ? body.region.toLowerCase() : undefined;
  const radiusMi =
    typeof body.radiusMi === "number"
      ? body.radiusMi
      : body.radiusMi != null
      ? Number(body.radiusMi)
      : undefined;

  const filtered = (seeds as Seed[]).filter(regionFilter(region));

  const scored = filtered
    .map((s) => {
      const { score, why } = scoreSeed(s, body.persona);
      const title =
        body.persona?.titles &&
        s.titles.find((t) => tokenize(body.persona?.titles || "").includes(t.toLowerCase()));
      return {
        id: s.id,
        company: s.company,
        website: s.website,
        host: hostOf(s.website),
        title: title || s.titles[0] || "Buyer",
        score,
        why,
      } as Candidate;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  const created = 0;
  const candidates =
    scored.length > 0
      ? scored
      : [{
          id: "seed-warm-1",
          company: "Example Co.",
          website: "https://example.com",
          host: "example.com",
          title: "Purchasing Manager",
          score: 0.35,
          why: "fallback demo"
        }];

  const payload: ResponsePayload = {
    created,
    candidates,
    inferred: { supplier, region, radiusMi },
    note: created === 0 && candidates.length > 0
      ? "seed-based matches (no external discovery yet)"
      : undefined
  };

  res.status(200).json(payload);
}