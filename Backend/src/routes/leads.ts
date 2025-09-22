import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import { runPipeline } from "../buyers/pipeline";

const router = Router();

/** ==== tiny in-memory store for the panel (stateless per pod) ==== */
type StoredLead = {
  id: number;
  host: string;
  platform?: string;
  title: string;
  created: string;
  temperature: "hot" | "warm";
  whyText?: string;
  why?: any;
};

let nextId = 1;
const store: { hot: StoredLead[]; warm: StoredLead[] } = { hot: [], warm: [] };
const saved: StoredLead[] = [];

function resetStore() {
  store.hot = [];
  store.warm = [];
  nextId = 1;
}

/** attach a helper on res to enforce x-api-key for write routes */
router.use((req, res, next) => {
  (res as any).requireKey = () => {
    const need = process.env.API_KEY || process.env.X_API_KEY;
    if (!need) return true;
    const got = req.header("x-api-key");
    if (got !== need) {
      res.status(401).json({ ok: false, error: "invalid api key" });
      return false;
    }
    return true;
  };
  next();
});

/** Health/ping */
router.get("/ping", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/** List current warm/hot buckets (used by the panel’s table) */
router.get("/", (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  const items = temp === "hot" ? store.hot : store.warm;
  res.json({ ok: true, items });
});

/** List “saved” (what the user locked) */
router.get("/saved", (_req, res) => {
  res.json({ ok: true, items: saved });
});

/** Find buyers from supplier (free returns 1 warm per click in the panel) */
router.post("/find-buyers", async (req, res) => {
  if (!(res as any).requireKey()) return; // must have key to write/compute

  try {
    const body = (req.body || {}) as {
      supplier?: string;
      region?: string;
      radiusMi?: number;
      persona?: any;
      onlyUSCA?: boolean;
    };

    if (!body.supplier || body.supplier.length < 3) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    // 1) Discovery (auto persona)
    const discovery = await runDiscovery({
      supplier: body.supplier.trim(),
      region: (body.region || "us").trim(),
      persona: body.persona,
    });

    // 2) Pipeline (Google News + targeted RSS feeds)
    const excludeEnterprise =
      String(process.env.EXCLUDE_ENTERPRISE || "true").toLowerCase() === "true";

    const { candidates } = await runPipeline(discovery, {
      region: discovery ? (body.region || "us") : body.region,
      radiusMi: body.radiusMi || 50,
      excludeEnterprise,
    });

    // 3) Normalize & store (panel format)
    const toLead = (c: any): StoredLead => {
      const title = c?.evidence?.[0]?.detail?.title || "";
      const link = c?.evidence?.[0]?.detail?.url || "";
      const host = link
        ? new URL(link).hostname.replace(/^www\./, "")
        : c?.domain || "unknown";
      const why = {
        signal: {
          label: c?.score >= 0.65 ? "Opening/launch signal" : "Expansion signal",
          score: Number((c?.score ?? 0).toFixed(2)),
          detail: title,
        },
        context: {
          label: (c?.source || "").startsWith("rss") ? "News (RSS)" : "News (Google)",
          detail: c?.source || "",
        },
      };
      return {
        id: nextId++,
        host,
        platform: "news",
        title,
        created: new Date().toISOString(),
        temperature: (c?.temperature as "hot" | "warm") || "warm",
        whyText: title,
        why,
      };
    };

    // for a fresh click we replace the working set (keeps UX predictable)
    store.hot = [];
    store.warm = [];

    const mapped = (candidates || []).map(toLead);
    for (const m of mapped) {
      (m.temperature === "hot" ? store.hot : store.warm).push(m);
    }

    const nHot = store.hot.length;
    const nWarm = store.warm.length;

    return res.json({
      ok: true,
      supplier: discovery?.supplierDomain || body.supplier,
      persona: discovery?.persona,
      latents: discovery?.latents,
      archetypes: discovery?.archetypes,
      candidates: mapped,
      cached: !!discovery?.cached,
      created: mapped.length,
      message: `Created ${mapped.length} candidate(s). Hot:${nHot} Warm:${nWarm}.`,
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

/** Lock & keep (free users: cap at 3 per process; Pro would persist in DB) */
router.post("/lock", (req, res) => {
  if (!(res as any).requireKey()) return;

  const { id } = (req.body || {}) as { id?: number };
  if (!id || typeof id !== "number") {
    return res.status(400).json({ ok: false, error: "id is required" });
  }

  const lead =
    store.hot.find((x) => x.id === id) ||
    store.warm.find((x) => x.id === id) ||
    saved.find((x) => x.id === id);

  if (!lead) {
    return res.status(404).json({ ok: false, error: "lead not found" });
  }

  // simple free cap (in-memory)
  const FREE_CAP = Number(process.env.FREE_LOCK_CAP || 3);
  if (saved.length >= FREE_CAP) {
    return res
      .status(402)
      .json({ ok: false, proOnly: true, error: "lock cap reached", cap: FREE_CAP });
  }

  if (!saved.some((x) => x.id === id)) saved.push(lead);
  return res.json({ ok: true, savedCount: saved.length, item: lead });
});

/** Deepen results (Pro-only stub; used to drive the upgrade CTA) */
router.post("/deepen", (req, res) => {
  if (!(res as any).requireKey()) return;

  const { id } = (req.body || {}) as { id?: number };
  if (!id || typeof id !== "number") {
    return res.status(400).json({ ok: false, error: "id is required" });
  }

  // We deliberately gate this behind Pro for now
  return res
    .status(402) // Payment Required — perfect for upgrade nudges
    .json({
      ok: false,
      proOnly: true,
      error: "Pro required to deepen this lead",
      includes: [
        "Source roll-up across 24h",
        "Direct contact enrichment (titles & emails)",
        "Competitive signals & recency spikes",
      ],
    });
});

/** internal clear (handy while iterating) */
router.post("/__clear", (req, res) => {
  if (!(res as any).requireKey()) return;
  resetStore();
  saved.length = 0;
  res.json({ ok: true });
});

export default router;