// src/routes/leads.ts
import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import { runPipeline } from "../buyers/pipeline";

const router = Router();

/** -----------------------------
 *  Types & tiny in-memory stores
 *  ----------------------------- */
type Temp = "hot" | "warm";

export type StoredLead = {
  id: number;
  host: string;
  platform?: string;
  title: string;
  created: string;
  temperature: Temp;
  whyText?: string;
  why?: any;
  lockedUntil?: string;   // when locked (24h TTL)
};

let nextId = 1;
const buckets: { hot: StoredLead[]; warm: StoredLead[] } = { hot: [], warm: [] };

/** Saved (locked) leads are per API key so different users don’t see each other’s locks. */
const savedByKey: Record<string, StoredLead[]> = Object.create(null);

/** Helpers */
function requireKeyFrom(res: any, req: any): string | null {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return ""; // no key configured = open for dev
  const got = req.header("x-api-key");
  if (got !== need) {
    res.status(401).json({ ok: false, error: "invalid api key" });
    return null;
  }
  return need;
}

function safeArray<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function toLead(c: any): StoredLead {
  // super defensive because upstream can be spotty
  const evidence = safeArray<any>(c?.evidence);
  const first = evidence[0] || {};
  const detail = first?.detail || {};
  const title = String(detail?.title || c?.title || "").trim();
  const link = String(detail?.url || c?.url || "").trim();
  let host = "unknown";
  try {
    host = link ? new URL(link).hostname.replace(/^www\./, "") : String(c?.domain || "unknown");
  } catch {
    host = String(c?.domain || "unknown");
  }

  const why = {
    signal: {
      label: typeof c?.score === "number" && c.score >= 0.65 ? "Opening/launch signal" : "Expansion signal",
      score: typeof c?.score === "number" ? Number(c.score.toFixed(2)) : 0.4,
      detail: title || "(no title)",
    },
    context: {
      label: String(c?.source || "").startsWith("rss") ? "News (RSS)" : "News (Google)",
      detail: String(c?.source || "google-news"),
    },
  };

  return {
    id: nextId++,
    host,
    platform: "news",
    title,
    created: new Date().toISOString(),
    temperature: (c?.temperature as Temp) === "hot" ? "hot" : "warm",
    whyText: title,
    why,
  };
}

function clearBuckets() {
  buckets.hot = [];
  buckets.warm = [];
  nextId = 1;
}

function nowPlusHours(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

/** -----------------------------
 *  Open ping (no auth)
 *  ----------------------------- */
router.get("/ping", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/** -----------------------------
 *  List candidates (hot/warm)
 *  GET /api/v1/leads?temp=hot|warm
 *  ----------------------------- */
router.get("/", (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  const items = temp === "hot" ? buckets.hot : buckets.warm;
  res.json({ ok: true, items });
});

/** -----------------------------
 *  Find buyers (from supplier)
 *  POST /api/v1/leads/find-buyers
 *  ----------------------------- */
router.post("/find-buyers", async (req, res) => {
  // key required IF configured
  if (requireKeyFrom(res, req) === null) return;

  try {
    const body = (req.body || {}) as {
      supplier?: string;
      region?: string;
      radiusMi?: number;
      persona?: any;
      onlyUSCA?: boolean;
    };

    if (!body.supplier || body.supplier.trim().length < 3) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    // 1) Discovery (auto persona)
    const discovery = await runDiscovery({
      supplier: body.supplier.trim(),
      region: String(body.region || "us").trim(),
      persona: body.persona,
    });

    // 2) Pipeline (news & feeds)
    const excludeEnterprise = String(process.env.EXCLUDE_ENTERPRISE || "true").toLowerCase() === "true";
    const { candidates } = await runPipeline(discovery, {
      region: discovery ? (body.region || "us") : body.region,
      radiusMi: body.radiusMi || 50,
      excludeEnterprise,
    });

    // 3) Normalize and refresh visible buckets (free shows 1 at a time; we still refresh all)
    clearBuckets();
    const mapped = safeArray<any>(candidates).map(toLead);
    for (const m of mapped) {
      (m.temperature === "hot" ? buckets.hot : buckets.warm).push(m);
    }

    const nHot = buckets.hot.length;
    const nWarm = buckets.warm.length;

    return res.json({
      ok: true,
      supplier: discovery?.supplierDomain || body.supplier.trim(),
      persona: discovery?.persona,
      latents: discovery?.latents,
      archetypes: discovery?.archetypes,
      candidates: mapped, // full set (UI still shows 1/ click in free)
      cached: !!discovery?.cached,
      created: mapped.length,
      message: `Created ${mapped.length} candidate(s). Hot:${nHot} Warm:${nWarm}.`,
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

/** -----------------------------
 *  Lock & keep (save for this API key)
 *  POST /api/v1/leads/lock   { id:number }
 *  ----------------------------- */
router.post("/lock", (req, res) => {
  const key = requireKeyFrom(res, req);
  if (key === null) return;

  const id = Number((req.body || {}).id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "id required" });
  }

  // find & remove from buckets
  let found: StoredLead | undefined;
  for (const t of ["hot", "warm"] as const) {
    const arr = buckets[t];
    const idx = arr.findIndex((x) => x.id === id);
    if (idx >= 0) {
      const [it] = arr.splice(idx, 1);
      found = it;
      break;
    }
  }

  if (!found) {
    return res.status(404).json({ ok: false, error: "lead not found (maybe already locked)" });
  }

  // add to this key's saved list
  const saved = (savedByKey[key] ||= []);
  // prevent dupes by host+title
  const dupe = saved.find((s) => s.host === found!.host && s.title === found!.title);
  if (!dupe) {
    found.lockedUntil = nowPlusHours(24);
    saved.push(found);
  }

  return res.json({
    ok: true,
    locked: true,
    id: found.id,
    savedCount: saved.length,
    lockedUntil: found.lockedUntil,
    message: "Locked for your team for 24h. It won’t show up for free users.",
  });
});

/** -----------------------------
 *  List saved (locked) for this API key
 *  GET /api/v1/leads/saved
 *  ----------------------------- */
router.get("/saved", (req, res) => {
  const key = requireKeyFrom(res, req);
  if (key === null) return;

  // prune expired locks (24h TTL)
  const now = Date.now();
  const saved = (savedByKey[key] ||= []);
  for (let i = saved.length - 1; i >= 0; i--) {
    const until = Date.parse(saved[i].lockedUntil || "");
    if (Number.isFinite(until) && until < now) saved.splice(i, 1);
  }

  res.json({ ok: true, items: saved });
});

/** -----------------------------
 *  Deepen results (free shows paywall preview)
 *  POST /api/v1/leads/deepen  { id:number }
 *  ----------------------------- */
router.post("/deepen", (req, res) => {
  // Free plan: only show a tiny preview + upsell flag.
  // (Pro can switch this later to do real enrichment.)
  const id = Number((req.body || {}).id);
  // Try to show a tiny preview of the row we’re “deepening”
  const candidate =
    buckets.hot.find((x) => x.id === id) ||
    buckets.warm.find((x) => x.id === id) ||
    null;

  return res.json({
    ok: true,
    need_pro: true,
    preview: candidate
      ? {
        id: candidate.id,
        host: candidate.host,
        snippet: candidate.whyText || candidate.title,
        extras: ["site crawl", "contact discovery", "intent freshness"].slice(0, 2),
      }
      : null,
    message: "Deep enrichment is a Pro feature. Upgrade to unlock contacts & fresh intent.",
  });
});

/** -----------------------------
 *  Clear (dev only)
 *  POST /api/v1/leads/__clear
 *  ----------------------------- */
router.post("/__clear", (req, res) => {
  if (requireKeyFrom(res, req) === null) return;
  clearBuckets();
  res.json({ ok: true });
});

export default router;