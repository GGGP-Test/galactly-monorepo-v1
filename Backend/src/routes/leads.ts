import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import { runPipeline } from "../buyers/pipeline";

const router = Router();

/* ----------------------------- types & helpers ---------------------------- */

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
};

// very light shape for pipeline candidates so TS doesn’t complain on optional fields
type PipelineCandidate = {
  temperature: Temp;
  source?: string;
  score?: number;
  domain?: string;
  evidence?: Array<{ detail?: { title?: string; url?: string } }>;
};

let nextId = 1;
const store: { hot: StoredLead[]; warm: StoredLead[] } = { hot: [], warm: [] };

// per-caller saved (what the UI shows as “Saved = what you locked”)
const savedByKey: Record<string, StoredLead[]> = Object.create(null);

function resetBuckets() {
  store.hot = [];
  store.warm = [];
  nextId = 1;
}

function getCallerKey(req: any): string {
  // used as an identifier for the “saved” bucket
  return (
    req.header("x-api-key") ||
    String(req.query.apiKey || "") ||
    "anon"
  );
}

// Optional API key guard for write routes (enforced only when configured)
router.use((req, res, next) => {
  (res as any).requireKey = () => {
    const need = process.env.API_KEY || process.env.X_API_KEY;
    if (!need) return true;
    const got = req.header("x-api-key") || String(req.query.apiKey || "");
    if (got !== need) {
      res.status(401).json({ ok: false, error: "invalid api key" });
      return false;
    }
    return true;
  };
  next();
});

/* --------------------------------- health -------------------------------- */

router.get("/ping", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

/* ------------------------------- read routes ------------------------------ */
/**
 * GET /api/v1/leads
 *   - ?temp=hot|warm (default: warm)  -> returns working set (no auth)
 *   - ?saved=1                        -> returns caller’s saved leads (auth required if API_KEY is set)
 */
router.get("/", (req, res) => {
  const wantSaved = String(req.query.saved || "") === "1";

  if (wantSaved) {
    const need = process.env.API_KEY || process.env.X_API_KEY;
    if (need) {
      // when a key is configured, require it for saved access
      const ok = (res as any).requireKey();
      if (!ok) return;
    }
    const caller = getCallerKey(req);
    return res.json({
      ok: true,
      items: savedByKey[caller] || [],
      saved: true,
    });
  }

  const temp = String(req.query.temp || "warm").toLowerCase() as Temp;
  const items = temp === "hot" ? store.hot : store.warm;
  res.json({ ok: true, items, saved: false });
});

/* ------------------------------- write routes ----------------------------- */

/**
 * POST /api/v1/leads/find-buyers
 * body: { supplier, region?, radiusMi?, persona?, onlyUSCA? }
 */
router.post("/find-buyers", async (req, res) => {
  if (!(res as any).requireKey()) return; // key required if configured

  try {
    const body = (req.body || {}) as {
      supplier?: string;
      region?: string;
      radiusMi?: number;
      persona?: any;
      onlyUSCA?: boolean;
    };

    if (!body.supplier || body.supplier.length < 3) {
      return res
        .status(400)
        .json({ ok: false, error: "supplier domain is required" });
    }

    // 1) discovery / auto-persona
    const discovery = await runDiscovery({
      supplier: body.supplier.trim(),
      region: (body.region || "us").trim(),
      persona: body.persona,
    });

    // 2) pipeline aggregation
    const excludeEnterprise =
      String(process.env.EXCLUDE_ENTERPRISE || "true").toLowerCase() === "true";

    const { candidates } = await runPipeline(discovery, {
      region: discovery ? (body.region || "us") : body.region,
      radiusMi: body.radiusMi || 50,
      excludeEnterprise,
    });

    // 3) normalize -> panel format
    const toLead = (c: PipelineCandidate): StoredLead => {
      const ev = (c.evidence && c.evidence[0]) || {};
      const title = ev?.detail?.title || "";
      const link = ev?.detail?.url || "";
      const host = link
        ? new URL(link).hostname.replace(/^www\./, "")
        : c.domain || "unknown";

      const score = typeof c.score === "number" ? c.score : 0;
      const why = {
        signal: {
          label: score >= 0.65 ? "Opening/launch signal" : "Expansion signal",
          score: Number(score.toFixed(2)),
          detail: title,
        },
        context: {
          label: (c.source || "").startsWith("rss") ? "News (RSS)" : "News (Google)",
          detail: c.source || "",
        },
      };

      return {
        id: nextId++,
        host,
        platform: "news",
        title,
        created: new Date().toISOString(),
        temperature: c.temperature || "warm",
        whyText: title,
        why,
      };
    };

    // refresh buckets
    store.hot = [];
    store.warm = [];

    const mapped: StoredLead[] = (candidates || []).map(toLead);

    for (const m of mapped) {
      if (m.temperature === "hot") store.hot.push(m);
      else store.warm.push(m);
    }

    const nHot = store.hot.length;
    const nWarm = store.warm.length;

    return res.json({
      ok: true,
      supplier: discovery.supplierDomain,
      persona: discovery.persona,
      latents: discovery.latents,
      archetypes: discovery.archetypes,
      candidates: mapped,
      cached: discovery.cached,
      created: mapped.length,
      message: `Created ${mapped.length} candidate(s). Hot:${nHot} Warm:${nWarm}.`,
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "internal error" });
  }
});

/**
 * POST /api/v1/leads/lock
 * body: { id?: number, lead?: Partial<StoredLead> }
 * - Copies the chosen lead into the caller’s saved bucket (does not “global-remove” on free).
 */
router.post("/lock", (req, res) => {
  if (!(res as any).requireKey()) return; // write requires key if configured

  const caller = getCallerKey(req);
  const body = (req.body || {}) as { id?: number; lead?: Partial<StoredLead> };

  let chosen: StoredLead | undefined;

  if (typeof body.id === "number") {
    chosen =
      store.hot.find((l) => l.id === body.id) ||
      store.warm.find((l) => l.id === body.id);
  }

  if (!chosen && body.lead) {
    const base = body.lead;
    chosen = {
      id: nextId++,
      host: base.host || "unknown",
      platform: base.platform || "news",
      title: base.title || "(untitled)",
      created: base.created || new Date().toISOString(),
      temperature: (base.temperature as Temp) || "warm",
      whyText: base.whyText,
      why: base.why,
    };
  }

  if (!chosen) {
    return res
      .status(400)
      .json({ ok: false, error: "lead not found or not provided" });
  }

  const bucket = (savedByKey[caller] ||= []);
  bucket.push(chosen);

  return res.json({
    ok: true,
    savedCount: bucket.length,
    saved: chosen,
  });
});

/* ------------------------------- maintenance ------------------------------ */

// dev helper to clear working buckets (requires key when configured)
router.post("/__clear", (req, res) => {
  if (!(res as any).requireKey()) return;
  resetBuckets();
  res.json({ ok: true });
});

// explicit alias for saved list (same as GET /?saved=1)
router.get("/saved", (req, res) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (need) {
    const ok = (res as any).requireKey();
    if (!ok) return;
  }
  const caller = getCallerKey(req);
  res.json({ ok: true, items: savedByKey[caller] || [], saved: true });
});

export default router;