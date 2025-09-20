import { Router, Request, Response } from "express";
import { runProviders } from "../providers";
import { loadLeadsFromDisk, saveLeadsToDisk } from "../utils/fsCache";

const router = Router();

/** -------------------------
 *  Minimal rolling leads store
 *  -------------------------
 */
type UICandidate = {
  id: number;
  host: string;
  platform: string;
  title: string;
  created: string;   // ISO string
  temp: string;      // "hot" | "warm" | other
  why: string;
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
  let changed = false;

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
    changed = true;
  }

  if (changed) {
    // fire-and-forget; keep server fast
    saveLeadsToDisk(LEADS).catch(() => void 0);
  }
}

// Try to load persisted leads on boot (fire-and-forget)
loadLeadsFromDisk()
  .then((arr) => {
    if (Array.isArray(arr)) {
      for (const r of arr) {
        LEADS.push(r as UICandidate);
        if (r.id && r.id >= NEXT_ID) NEXT_ID = r.id + 1;
      }
      if (LEADS.length > MAX_LEADS) LEADS.splice(0, LEADS.length - MAX_LEADS);
    }
  })
  .catch(() => void 0);

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

    upsertLeads(candidates as any[], input.region);

    const hot = (candidates as any[]).filter((c) => c?.temp === "hot").length;
    const warm = (candidates as any[]).filter((c) => c?.temp === "warm").length;

    return res.status(200).json({
      ok: true,
      created: Array.isArray(candidates) ? candidates.length : 0,
      counts: { hot, warm },
      candidates,
      meta: { ms: Date.now() - t0, ...(meta || {}) },
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err ?? "unexpected error"),
    });
  }
});

/** -------------------------------
 *  GET /api/v1/leads  (+ synonyms)
 *  -------------------------------
 *  Query: temp=hot|warm|all, region=..., limit, offset
 */
function listLeads(req: Request, res: Response) {
  const q = req.query as Record<string, any>;
  const temp = String(q.temp ?? "all").toLowerCase();
  const region = q.region ? String(q.region).toLowerCase() : undefined;
  const limit = Math.max(1, Math.min(100, Number(q.limit ?? 20)));
  const offset = Math.max(0, Number(q.offset ?? 0));

  let items = LEADS.slice().sort((a, b) => (a.created < b.created ? 1 : -1));
  if (temp !== "all") items = items.filter((x) => String(x.temp).toLowerCase() === temp);
  if (region) items = items.filter((x) => (x.region ?? "").toLowerCase() === region);

  return res.status(200).json(items.slice(offset, offset + limit));
}

router.get("/api/v1/leads", listLeads);
router.get("/api/v1/leads/", listLeads);          // trailing-slash tolerant
router.get("/api/v1/leads/hot", (req, res) => {   // legacy-style
  (req.query as any).temp = "hot";
  return listLeads(req, res);
});
router.get("/api/v1/leads/warm", (req, res) => {
  (req.query as any).temp = "warm";
  return listLeads(req, res);
});

// tiny health check (useful locally)
router.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

export default router;