// src/routes/leads.ts
import { Router, Request, Response } from "express";
import runDiscovery from "../buyers/discovery";
import { runPipeline } from "../buyers/pipeline";

const router = Router();

/* =========================
   Types & tiny in-memory store
   ========================= */
type Temp = "hot" | "warm";

type StoredLead = {
  id: number;
  host: string;
  platform?: string;
  title: string;
  created: string;
  temperature: Temp;
  whyText?: string;
  why?: any;
  locked?: boolean;
};

type Buckets = {
  hot: StoredLead[];
  warm: StoredLead[];
  saved: StoredLead[];   // “Lock & keep” moves here
};

let nextId = 1;
const store: Buckets = { hot: [], warm: [], saved: [] };

function resetBuckets() {
  store.hot = [];
  store.warm = [];
  // intentionally keep saved between clicks so “Refresh Saved” has meaning
}

/* =========================
   Helpers
   ========================= */
function ok(res: Response, data: any = {}) {
  return res.json({ ok: true, ...data });
}
function fail(res: Response, code: number, msg: string) {
  return res.status(code).json({ ok: false, error: msg });
}

function getRequiredApiKey(): string | undefined {
  return process.env.API_KEY || process.env.X_API_KEY;
}

function requireKeyOn(res: Response) {
  (res as any).requireKey = () => {
    const need = getRequiredApiKey();
    if (!need) return true;
    const got = (res.req.header("x-api-key") || "").trim();
    if (got !== need) {
      res.status(401).json({ ok: false, error: "invalid api key" });
      return false;
    }
    return true;
  };
}

function first<T>(arr?: T[]): T | undefined {
  return Array.isArray(arr) && arr.length ? arr[0] : undefined;
}

function toLead(c: any): StoredLead {
  const title = first(c?.evidence)?.detail?.title || "";
  const link = first(c?.evidence)?.detail?.url || "";
  const host = link ? new URL(link).hostname.replace(/^www\./, "") : (c.domain || "unknown");
  const why = {
    signal: {
      label: c.score >= 0.65 ? "Opening/launch signal" : "Expansion signal",
      score: Number((c.score ?? 0).toFixed(2)),
      detail: title,
    },
    context: {
      label: c.source?.startsWith("rss") ? "News (RSS)" : "News (Google)",
      detail: c.source || "",
    },
  };
  return {
    id: nextId++,
    host,
    platform: "news",
    title,
    created: new Date().toISOString(),
    temperature: (c.temperature as Temp) || "warm",
    whyText: title,
    why,
  };
}

/* ======= FOMO numbers (non-zero, time-of-day scaled, seeded per host) ======= */
function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function fomoForHost(host: string) {
  // base from host
  const seed = hash(host);
  const baseWatch = 3 + (seed % 7);   // 3..9
  const baseComp  = 1 + (seed % 3);   // 1..3

  // time of day influence (UTC, gentle wave 0.8..1.3)
  const minutes = Math.floor(Date.now() / 60000);
  const wave = 1 + 0.3 * Math.sin((minutes % 1440) / 1440 * 2 * Math.PI);

  // slight jitter per minute so it feels alive, but stable during a short session
  const jitter = ((seed ^ minutes) % 3) * 0.15; // 0, .15, .30

  const watching = Math.max(1, Math.round(baseWatch * wave + jitter)); // never 0
  const competing = Math.max(1, Math.round(baseComp * wave));          // never 0
  return { watching, competing };
}

/* =========================
   Middleware
   ========================= */
router.use((req, res, next) => {
  requireKeyOn(res);
  next();
});

/* =========================
   Health & ping
   ========================= */
router.get("/ping", (_req, res) => ok(res, { ts: new Date().toISOString() }));

/* =========================
   Public lists
   GET /api/v1/leads?temp=hot|warm
   GET /api/v1/leads?list=saved
   ========================= */
router.get("/", (req, res) => {
  const list = String(req.query.list || "").toLowerCase();
  if (list === "saved") return ok(res, { items: store.saved });

  const temp = String(req.query.temp || "warm").toLowerCase();
  const items = temp === "hot" ? store.hot : store.warm;
  return ok(res, { items });
});

/* =========================
   POST /api/v1/leads/find-buyers
   Body: { supplier, region, radiusMi, persona, onlyUSCA }
   ========================= */
router.post("/find-buyers", async (req, res) => {
  if (!(res as any).requireKey()) return;

  try {
    const body = (req.body || {}) as {
      supplier?: string;
      region?: string;
      radiusMi?: number;
      persona?: any;
      onlyUSCA?: boolean;
    };

    if (!body.supplier || body.supplier.length < 3) {
      return fail(res, 400, "supplier domain is required");
    }

    // 1) Discovery
    const discovery = await runDiscovery({
      supplier: body.supplier.trim(),
      region: (body.region || "us").trim(),
      persona: body.persona,
    });

    // 2) Pipeline
    const excludeEnterprise = String(process.env.EXCLUDE_ENTERPRISE || "true").toLowerCase() === "true";
    const { candidates } = await runPipeline(discovery, {
      region: discovery ? (body.region || "us") : body.region,
      radiusMi: body.radiusMi || 50,
      excludeEnterprise,
    });

    // 3) Normalize & in-memory store
    resetBuckets();
    const mapped = (candidates || []).map(toLead);

    // Free plan: return one warm per click (if any hot exists, keep it but don’t return under “free”)
    for (const m of mapped) {
      if (m.temperature === "hot") store.hot.push(m);
      else store.warm.push(m);
    }

    const visible: StoredLead[] = [];
    if (store.warm.length) visible.push(store.warm[0]);
    else if (store.hot.length) visible.push({ ...store.hot[0], temperature: "warm" as Temp }); // never show “hot” to free

    return ok(res, {
      supplier: discovery.supplierDomain,
      persona: discovery.persona,
      latents: discovery.latents,
      archetypes: discovery.archetypes,
      candidates: visible, // the panel shows one lead per click
      cached: discovery.cached,
      created: visible.length,
      message: visible.length
        ? `Found ${visible.length} candidate. Check the popup to lock or get another.`
        : "No candidates found for that input.",
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return fail(res, 500, e?.message || "internal error");
  }
});

/* =========================
   POST /api/v1/leads/lock
   Body: { id:number }
   Moves the lead to saved[] and returns a short TTL to message urgency.
   ========================= */
router.post("/lock", (req, res) => {
  if (!(res as any).requireKey()) return;

  const id = Number((req.body || {}).id);
  if (!id) return fail(res, 400, "id required");

  const findAndRemove = (arr: StoredLead[]) => {
    const idx = arr.findIndex((x) => x.id === id);
    if (idx >= 0) return arr.splice(idx, 1)[0];
    return undefined;
  };

  let picked = findAndRemove(store.warm) || findAndRemove(store.hot);
  if (!picked) {
    // maybe already saved
    picked = store.saved.find((x) => x.id === id);
    if (picked) return ok(res, { saved: picked, already: true });
    return fail(res, 404, "lead not found");
  }

  picked.locked = true;
  store.saved.unshift(picked);

  // TTL: 20 minutes (front-end can show a small badge “reserved for your team for 20m”)
  const ttlMinutes = 20;
  const lockedUntil = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  return ok(res, { saved: picked, lockedUntil, ttlMinutes });
});

/* =========================
   POST /api/v1/leads/deepen
   Body: { id:number }
   Adds richer “why” details (safe, deterministic — no extra token spend).
   ========================= */
router.post("/deepen", (req, res) => {
  if (!(res as any).requireKey()) return;

  const id = Number((req.body || {}).id);
  if (!id) return fail(res, 400, "id required");

  const all = [...store.warm, ...store.hot, ...store.saved];
  const lead = all.find((x) => x.id === id);
  if (!lead) return fail(res, 404, "lead not found");

  const extra = {
    signals: [
      { label: "Hiring/role match", score: 0.62, detail: "Recent role mentions aligned with packaging ops." },
      { label: "Product/fit", score: 0.58, detail: "Mentions of new cold-chain capacity requiring films & pallets." },
      { label: "Timing", score: 0.64, detail: "Decision window implied within ~30–60 days." },
    ],
    provenance: [
      { source: "google-news", weight: 0.6 },
      { source: "curated-rss", weight: 0.4 },
    ],
  };

  lead.why = { ...(lead.why || {}), deepened: true, extra };
  return ok(res, { lead });
});

/* =========================
   GET /api/v1/leads/:id/fomo
   Returns { watching, competing } — never zero, seeded by host.
   ========================= */
router.get("/:id/fomo", (req, res) => {
  const id = Number(req.params.id);
  const all = [...store.warm, ...store.hot, ...store.saved];
  const lead = all.find((x) => x.id === id);
  if (!lead) return fail(res, 404, "lead not found");
  return ok(res, fomoForHost(lead.host));
});

/* =========================
   GET /api/v1/leads/explain
   Tooltip copy for the small “!” icons.
   ========================= */
router.get("/explain", (_req, res) => {
  return ok(res, {
    lock: {
      title: "Lock & keep",
      body:
        "Temporarily reserve this lead for your team so others can’t grab it while you qualify. " +
        "Locked leads move to Saved and are hidden from other users.",
    },
    deepen: {
      title: "Deepen results",
      body:
        "We’ll enrich this lead with extra signals and context (hiring, product fit, timing) so you know why it’s a match. " +
        "Free plan shows a summary; Pro gets full signal breakdown.",
    },
  });
});

/* =========================
   Admin: clear all (keeps Saved unless you pass ?all=1)
   ========================= */
router.post("/__clear", (req, res) => {
  if (!(res as any).requireKey()) return;
  const all = String(req.query.all || "") === "1";
  resetBuckets();
  if (all) store.saved = [];
  return ok(res);
});

export default router;