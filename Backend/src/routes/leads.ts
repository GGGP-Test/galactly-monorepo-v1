import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import { runPipeline } from "../buyers/pipeline";

const router = Router();

// === minimal in-memory store for panel ===
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
function resetStore() {
  store.hot = [];
  store.warm = [];
  nextId = 1;
}

// Optional API key guard for write routes.
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

// Health & ping (for quick checks)
router.get("/ping", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

// GET /api/v1/leads?temp=hot|warm
router.get("/", (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  const items = temp === "hot" ? store.hot : store.warm;
  res.json({ ok: true, items });
});

// POST /api/v1/leads/find-buyers
router.post("/find-buyers", async (req, res) => {
  if (!(res as any).requireKey()) return; // require API key if configured

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

    // 1) Discovery (auto persona)
    const discovery = await runDiscovery({
      supplier: body.supplier.trim(),
      region: (body.region || "us").trim(),
      persona: body.persona,
    });

    // 2) Pipeline (Google News + targeted RSS feeds)
    const excludeEnterprise =
      String(process.env.EXCLUDE_ENTERPRISE || "true").toLowerCase() ===
      "true";

    const { candidates } = await runPipeline(discovery, {
      region: discovery ? body.region || "us" : body.region,
      radiusMi: body.radiusMi || 50,
      excludeEnterprise,
    });

    // 3) Normalize & store (panel format)
    const toLead = (c: any): StoredLead => {
      // --- guard all nested access to keep TS happy ---
      const evArr = Array.isArray((c as any).evidence)
        ? ((c as any).evidence as any[])
        : [];
      const ev0 = evArr.length ? evArr[0] : undefined;
      const detail = ev0 && typeof ev0 === "object" ? (ev0 as any).detail || {} : {};
      const title =
        detail && typeof detail.title === "string" ? detail.title : "";
      const link =
        detail && typeof detail.url === "string" ? detail.url : "";
      const host = link
        ? new URL(link).hostname.replace(/^www\./, "")
        : (c.domain as string) || "unknown";

      const why = {
        signal: {
          label:
            typeof c.score === "number" && c.score >= 0.65
              ? "Opening/launch signal"
              : "Expansion signal",
          score:
            typeof c.score === "number" ? Number(c.score.toFixed(2)) : 0,
          detail: title,
        },
        context: {
          label:
            typeof c.source === "string" && c.source.startsWith("rss")
              ? "News (RSS)"
              : "News (Google)",
          detail: c.source,
        },
      };

      return {
        id: nextId++,
        host,
        platform: "news",
        title,
        created: new Date().toISOString(),
        temperature: (c.temperature as "hot" | "warm") || "warm",
        whyText: title,
        why,
      };
    };

    // wipe buckets for a predictable UX each click
    store.hot = [];
    store.warm = [];

    const mapped = Array.isArray(candidates) ? candidates.map(toLead) : [];
    for (const m of mapped) {
      if (m.temperature === "hot") store.hot.push(m);
      else store.warm.push(m);
    }

    const nHot = store.hot.length;
    const nWarm = store.warm.length;

    return res.json({
      ok: true,
      supplier: discovery?.supplierDomain,
      persona: discovery?.persona,
      latents: discovery?.latents,
      archetypes: discovery?.archetypes,
      candidates: mapped,
      cached: discovery?.cached,
      created: mapped.length,
      message: `Created ${mapped.length} candidate(s). Hot:${nHot} Warm:${nWarm}. Refresh lists to view.`,
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "internal error" });
  }
});

// (optional) clear
router.post("/__clear", (req, res) => {
  if (!(res as any).requireKey()) return;
  resetStore();
  res.json({ ok: true });
});

export default router;