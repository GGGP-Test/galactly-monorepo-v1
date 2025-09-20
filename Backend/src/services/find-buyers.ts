// src/services/find-buyers.ts
import type { Request, Response, NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// ---------- Config ----------
const CACHE_TTL_MS =
  Number(process.env.FINDBUYERS_TTL_MS || "") || 10 * 60 * 1000; // 10 min
const CACHE_DIR =
  process.env.CACHE_DIR || path.join(process.cwd(), "cache", "find-buyers");

// ---------- Contracts ----------
type Temp = "warm" | "hot";
interface Persona {
  offer: string;
  solves: string;
  titles: string;
}
interface FindBuyersInput {
  supplier: string;
  region: string;
  radiusMi: number;
  onlyUSCA?: boolean;
  persona: Persona;
}
interface Candidate {
  id: string;
  host: string;
  platform: "web" | "news" | "social" | "other";
  title: string;
  created: string; // ISO timestamp
  temp: Temp;
  why: string;
}
interface FindBuyersResult {
  ok: true;
  tookMs: number;
  supplier: string;
  region: string;
  radiusMi: number;
  persona: Persona;
  created: number;
  hot: number;
  warm: number;
  candidates: Candidate[];
  cache?: "hit" | "miss"; // visibility only
}

// ---------- Helpers ----------
const nowIso = () => new Date().toISOString();

function stableKey(input: FindBuyersInput): string {
  const payload = JSON.stringify({
    supplier: input.supplier.trim().toLowerCase(),
    region: input.region.trim().toLowerCase(),
    radiusMi: Number(input.radiusMi || 0),
    onlyUSCA: Boolean(input.onlyUSCA),
    persona: {
      offer: (input.persona?.offer ?? "").trim().toLowerCase(),
      solves: (input.persona?.solves ?? "").trim().toLowerCase(),
      titles: (input.persona?.titles ?? "").trim().toLowerCase(),
    },
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function readCache<T>(key: string): Promise<T | null> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${key}.json`);
    const raw = await fs.readFile(file, "utf8");
    const { ts, data } = JSON.parse(raw) as { ts: number; data: T };
    if (Date.now() - ts <= CACHE_TTL_MS) return data;
    fs.unlink(file).catch(() => {});
    return null;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${key}.json`);
    await fs.writeFile(file, JSON.stringify({ ts: Date.now(), data }), "utf8");
  } catch {
    // best-effort; ignore
  }
}

function sanitize(input: any): FindBuyersInput {
  const supplier = String(input?.supplier ?? "").trim();
  const region = String(input?.region ?? "usca").trim().toLowerCase();
  const r = Number(input?.radiusMi);
  const radiusMi = Number.isFinite(r) ? r : 50;
  const onlyUSCA = Boolean(input?.onlyUSCA ?? true);
  const persona: Persona = {
    offer: String(input?.persona?.offer ?? ""),
    solves: String(input?.persona?.solves ?? ""),
    titles: String(input?.persona?.titles ?? ""),
  };
  if (!supplier) {
    throw Object.assign(new Error("supplier is required"), { status: 400 });
  }
  return { supplier, region, radiusMi, onlyUSCA, persona };
}

// Demo generator (swap later for real providers)
function makeCandidates(supplier: string, count = 20): Candidate[] {
  const roles = [
    "Purchasing Manager",
    "Procurement Lead",
    "Buyer",
    "Head of Ops",
    "Sourcing Manager",
    "Supply Chain Manager",
    "Operations Manager",
    "Plant Manager",
    "Warehouse Manager",
    "Materials Manager",
  ];
  const out: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `${supplier.replace(/\W+/g, "")}.${i + 1}`,
      host: supplier,
      platform: "web",
      title: roles[i % roles.length],
      created: nowIso(),
      temp: "warm",
      why: `demo match for ${supplier}`,
    });
  }
  return out;
}

// ---------- Controller ----------
export default async function findBuyers(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const t0 = Date.now();
  try {
    const raw =
      req.method === "GET"
        ? JSON.parse(String(req.query.input ?? "{}"))
        : (req.body ?? {});
    const input = sanitize(raw);
    const key = stableKey(input);

    const cached = await readCache<FindBuyersResult>(key);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.status(200).json({
        ...cached,
        cache: "hit",
        tookMs: Date.now() - t0,
      });
    }

    // Compute (demo) results
    const candidates = makeCandidates(input.supplier, 20);
    const warm = candidates.filter(c => c.temp === "warm").length;
    const hot = candidates.filter(c => c.temp === "hot").length;

    const payload: FindBuyersResult = {
      ok: true,
      tookMs: Date.now() - t0,
      supplier: input.supplier,
      region: input.region,
      radiusMi: input.radiusMi,
      persona: input.persona,
      created: candidates.length,
      hot,
      warm,
      candidates,
      cache: "miss",
    };

    // write cache (best effort)
    writeCache(key, payload).catch(() => {});
    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
}