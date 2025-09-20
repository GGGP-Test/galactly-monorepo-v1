import { Router, Request, Response } from "express";
import { runProviders } from "../providers";

const router = Router();

/** -------------------------
 *  Minimal in-memory store
 *  -------------------------
 *  This exists only to make the Free Panel’s
 *  GET /api/v1/leads work. It keeps a rolling
 *  window of the most recent leads in memory.
 */

type UICandidate = {
  id: number;
  host: string;
  platform: string;
  title: string;
  created: string;                 // ISO
  temp: string;                    // "hot" | "warm" | other
  why: string;                     // short human reason
  region?: string;
};

const LEADS: UICandidate[] = [];
let NEXT_ID = 1;
const MAX_LEADS = 1000;

function toHost(urlOrDomain: any): string {
  try {
    if (!urlOrDomain) return "";
    const s = String(urlOrDomain);
    if (s.includes("://")) return new URL(s).hostname;
    return s.replace(/^www\./, "");
  } catch {
    return String(urlOrDomain ?? "");
  }
}

function upsertLeads(candidates: any[], region: string) {
  for (const c of candidates ?? []) {
    const host = toHost(c?.host ?? c?.domain ?? c?.url ?? c?.website);
    const title = String(c?.title ?? c?.label ?? "Buyer");
    const temp = String(c?.temp ?? c?.heat ?? "warm");
    const why =
      String(c?.proof ?? c?.reason ?? c?.why ?? "").slice(0, 240) ||
      "auto-detected buyer signals";
    const platform = String(c?.source ?? c?.platform ?? "web");

    // Simple de-dupe: host+title+platform
    const key = `${host}|${title}|${platform}`;
    const existingIdx = LEADS.findIndex(
      (x) => `${x.host}|${x.title}|${x.platform}` === key
    );

    const rec: UICandidate = {
      id: existingIdx >= 0 ? LEADS[existingIdx].id : NEXT_ID++,
      host,
      platform,
      title,
      temp,
      why,
      region,
      created: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      LEADS[existingIdx] = rec;
    } else {
      LEADS.push(rec);
      if (LEADS.length > MAX_LEADS) LEADS.splice(0, LEADS.length - MAX_LEADS);
    }
  }
}

/** ------------------------------------
 *  POST /api/v1/leads/find-buyers
 *  ------------------------------------
 *  Body: { supplier, region?, radiusMi?, persona?{offer?, solves?, titles?: string|string[]} }
 */
router.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, any>;
    const supplier = body.supplier ?? "";

    if (!supplier || typeof supplier !== "string") {
      return res.status(400).json({ ok: false, error: "supplier (domain) is required" });
    }

    const persona = body.persona ?? {};
    const titles = Array.isArray(persona.titles)
      ? persona.titles.join(", ")
      : (persona.titles ?? "");

    const input = {
      supplier,
      region: String(body.region ?? "usca").toLowerCase(),
      radiusMi: Number(body.radiusMi ?? 50),
      persona: {
        offer: persona.offer ?? "",
        solves: persona.solves ?? "",
        titles,
      },
    };

    const t0 = Date.now();
    const { candidates = [], meta = {} } = (await runProviders(input as any)) as any;

    // Update in-memory store so GET /api/v1/leads can show results
    upsertLeads(candidates as any[], input.region);

    const hot = (candidates as any[]).filter((c) => c?.temp === "hot").length;
    const warm = (candidates as any[]).filter((c) => c?.temp === "warm").length;

    const payload = {
      ok: true,
      created: Array.isArray(candidates) ? candidates.length : 0,
      counts: { hot, warm },              // separate object to avoid duplicate keys
      candidates,
      meta: {
        ms: Date.now() - t0,
        ...(meta || {}),
      },
    };

    return res.status(200).json(payload);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err ?? "unexpected error"),
    });
  }
});

/** -------------------------------
 *  GET /api/v1/leads
 *  -------------------------------
 *  Query: temp=hot|warm|all, region=..., limit, offset
 *  Returns newest-first items that match.
 */
router.get("/api/v1/leads", (req: Request, res: Response) => {
  const q = req.query as Record<string, any>;
  const temp = String(q.temp ?? "all").toLowerCase();
  const region = q.region ? String(q.region).toLowerCase() : undefined;
  const limit = Math.max(1, Math.min(100, Number(q.limit ?? 20)));
  const offset = Math.max(0, Number(q.offset ?? 0));

  let items = LEADS.slice().sort((a, b) => (a.created < b.created ? 1 : -1));

  if (temp !== "all") items = items.filter((x) => String(x.temp).toLowerCase() === temp);
  if (region) items = items.filter((x) => (x.region ?? "").toLowerCase() === region);

  const total = items.length;
  const page = items.slice(offset, offset + limit);

  // Keep response dead-simple for the Free Panel
  return res.status(200).json(page);
});

/** Optional tiny health endpoint (handy in local dev) */
router.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

export default router;