import { Router } from "express";
import { collectNews } from "../buyers/adapters/news";

type Lead = {
  id: string;
  host: string;
  title: string;
  created: string;
  temperature: "hot" | "warm";
  platform?: string;
  whyText?: string;
  why?: any;
};
const mem = { hot: [] as Lead[], warm: [] as Lead[] };
const MAX_KEEP = 300;

function addLead(bucket: "hot" | "warm", lead: Lead) {
  const key = `${lead.host}::${lead.title}`;
  if (!mem[bucket].some((x) => `${x.host}::${x.title}` === key)) {
    mem[bucket].unshift(lead);
    if (mem[bucket].length > MAX_KEEP) mem[bucket].length = MAX_KEEP;
  }
}
function listLeads(bucket: "hot" | "warm") {
  return mem[bucket];
}

// Tighten signal quality
const RE_FACILITY =
  /\b(warehouse|distribution\s+center|fulfillment\s+center|cold\s+storage|distribution\s+centre)\b/i;
const RE_ACTION =
  /\b(open|opening|opens|launched|launch|expands|expansion|groundbreaking|ribbon\s+cutting|new\s+facility)\b/i;

const router = Router();

// ---- API key guard (unchanged) ----
router.use((req, res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need) return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
});

// ---- NO-CACHE for this router (fixes 304 / empty list) ----
router.use((req, res, next) => {
  // Disable etag-based 304s and all caching on these endpoints
  req.app.set("etag", false);
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// GET /api/v1/leads?temp=hot|warm  (used by Free Panel)
router.get("/", (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  if (temp !== "hot" && temp !== "warm") {
    return res.status(400).json({ ok: false, error: "temp must be hot|warm" });
  }
  const items = listLeads(temp as "hot" | "warm");
  return res.status(200).json({ ok: true, count: items.length, items });
});

// Simple probe: /api/v1/leads/ping-news?region=usca&q=...
router.get("/ping-news", async (req, res) => {
  try {
    const region = String(req.query.region || "usca").toLowerCase() as "us" | "ca" | "usca";
    const q =
      (req.query.q as string) ||
      '("warehouse" OR "distribution center" OR "fulfillment center" OR "cold storage") + (open OR opening OR opens OR launch OR launched OR expands OR expansion OR groundbreaking OR "ribbon cutting" OR "new facility")';
    const raw = await collectNews({ region, query: q, limit: 15 });
    const sample = raw.slice(0, 5);
    res.status(200).json({ ok: true, region, query: q, adapterCount: raw.length, sample });
  } catch (e: any) {
    console.error("[ping-news:error]", e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || "ping failed" });
  }
});

// POST /api/v1/leads/find-buyers  (called by “Find buyers”)
router.post("/find-buyers", async (req, res) => {
  try {
    const body = (req.body || {}) as { supplier?: string; region?: string; radiusMi?: number; persona?: any };
    if (!body.supplier || body.supplier.length < 3) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    const region = String(body.region || "usca").toLowerCase() as "us" | "ca" | "usca";
    const query =
      '("warehouse" OR "distribution center" OR "fulfillment center" OR "cold storage") + (open OR opening OR opens OR launch OR launched OR expands OR expansion OR groundbreaking OR "ribbon cutting" OR "new facility")';

    // Pull from Google News RSS
    const raw = await collectNews({ region, query, limit: 50 });

    // Filter to keep only facility + action
    const filtered = raw.filter((it) => {
      const t = `${it.title} ${it.description || ""}`.toLowerCase();
      return RE_FACILITY.test(t) && RE_ACTION.test(t);
    });

    let created = 0;
    const now = new Date().toISOString();
    const candidates: Lead[] = [];

    for (const it of filtered) {
      const title = it.title || "(untitled)";
      const text = `${title} ${it.description || ""}`.toLowerCase();
      const isHot = /\b(open|opening|opens|launched|ribbon|groundbreaking)\b/.test(text);
      const temp: "hot" | "warm" = isHot ? "hot" : "warm";
      const host = (it.domain || it.host || "news.google.com").replace(/^www\./, "");

      const lead: Lead = {
        id: `${host}::${title}`.slice(0, 200),
        host,
        title,
        created: now,
        temperature: temp,
        platform: "news",
        whyText: `${title} (${it.date || ""})`,
        why: {
          signal: {
            label: isHot ? "Opening/launch signal" : "Expansion signal",
            score: isHot ? 1 : 0.33,
            detail: title,
          },
          context: { label: "News (RSS)", detail: host },
        },
      };

      addLead(temp, lead);
      candidates.push(lead);
      created++;
    }

    return res.status(200).json({
      ok: true,
      created,
      candidates,
      message:
        created > 0 ? "Candidates created from news signals. Refresh lists to view." : "No qualifying signals found.",
      debug: { region, query, adapterCount: raw.length, kept: filtered.length },
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

export default router;