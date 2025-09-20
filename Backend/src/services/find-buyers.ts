// src/services/find-buyers.ts
import type { Request, Response, NextFunction } from "express";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// ---------- Config (tweak via env without code changes) ----------
const CACHE_TTL_MS =
  Number(process.env.FINDBUYERS_TTL_MS || "") || 10 * 60 * 1000; // 10 minutes
const CACHE_DIR =
  process.env.CACHE_DIR || path.join(process.cwd(), "cache", "find-buyers");

// ---------- Local input / output contracts (kept minimal & stable) ----------
type Temp = "warm" | "hot";
interface Persona {
  offer: string;
  solves: string;
  titles: string;
}
interface FindBuyersInput {
  supplier: string;        // e.g. "peekpackaging.com"
  region: string;          // e.g. "usca"
  radiusMi: number;        // e.g. 50
  onlyUSCA?: boolean;      // panel toggle
  persona: Persona;        // free-text hints
}
interface Candidate {
  id: string;
  host: string;
  platform: "web" | "news" | "social" | "other";
  title: string;
  created: string;         // ISO
  temp: Temp;
  why: string;             // human-readable reason
}
interface FindBuyersResult {
  ok: true;
  tookMs: number;
  supplier: string;
  region: string;
  radiusMi: number;
  persona: Persona;
  created: number;         // count created
  hot: number;
  warm: number;
  candidates: Candidate[];
}

// ---------- Small helpers ----------
const nowIso = () => new Date().toISOString();

function stableKey(input: FindBuyersInput): string {
  // Order & normalize fields for a deterministic cache key
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
    const buf = await fs.readFile(file, "utf8");
    const { ts, data } = JSON.parse(buf) as { ts: number; data: T };
    if (Date.now() - ts <= CACHE_TTL_MS) return data;
    // stale -> ignore but try to unlink in the background
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
    const payload = JSON.stringify({ ts: Date.now(), data });
    await fs.writeFile(file, payload, "utf8");
  } catch {
    // best-effort cache; ignore write errors
  }
}

function sanitize(input: any): FindBuyersInput {
  const supplier = String(input?.supplier ?? "").trim();
  const region = String(input?.region ?? "usca").trim().toLowerCase();
  const radiusMiRaw = Number(input?.radiusMi);
  const radiusMi = Number.isFinite(radiusMiRaw) ? radiusMiRaw : 50;
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

// Demo candidate generator (replace later with real providers)
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
  const list: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    const title = roles[i % roles.length];
    list.push({
      id: `${supplier.replace(/\W+/g, "")}.${i + 1}`,
      host: supplier,
      platform: "web",
      title,
      created: nowIso(),
      temp: "warm",
      why: `demo match for ${supplier}`,
    });
  }
  return list;
}

// ---------- Controller ----------
export default async function findBuyers(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const t0 = Date.now();
  try {
    // Accept both POST body and (rare) GET with ?input={}
    const raw =
      req.method === "GET"
        ? JSON.parse(String(req.query.input ?? "{}"))
        : (req.body ?? {});
    const input = sanitize(raw);
    const key = stableKey(input);

    // Cache hit?
    const cached = await readCache<FindBuyersResult>(key);
    if (cached) {
      return res.status(200).json({
        ...cached,
        tookMs: Date.now() - t0, // refresh timing for UI even on cache hit
      });
    }

    // Compute (demo) candidates
    const candidates = makeCandidates(input.supplier, 20);

    const warm = candidates.filter((c) => c.temp === "warm").length;
    const hot = candidates.filter((c) => c.temp === "hot").length;

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
    };

    // Best-effort cache write (don’t block response)
    writeCache(key, payload).catch(() => {});

    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
}