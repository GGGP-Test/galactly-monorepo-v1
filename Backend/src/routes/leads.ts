import { Router } from "express";
import { collectNews } from "../buyers/adapters/news"; // <-- uses your existing adapter
import { saveLeads, listLeads } from "../data/leads.db";

const router = Router();

/** Optional API key guard. If no key is set, this is a no-op. */
router.use((req, res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need) return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
});

/** Prevent browser/CDN caching of API responses (avoids 304 / stale UI). */
router.use((_, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
  next();
});

/** GET /api/v1/leads?temp=hot|warm  — list persisted leads */
router.get("/", (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  if (temp !== "hot" && temp !== "warm") {
    return res.status(400).json({ ok: false, error: "temp must be hot|warm" });
  }
  const items = listLeads(temp as "hot" | "warm").map((r) => ({
    id: r.id,
    host: r.host,
    title: r.title,
    created: r.created,
    temperature: r.temp,
    why: r.why,
  }));
  return res.status(200).json({ ok: true, count: items.length, items });
});

/** Lightweight heuristics to keep only real facility events. */
const RE_FACILITY =
  /\b(warehouse|distribution\s+center|distribution\s+centre|fulfillment\s+center|cold\s+storage)\b/i;
const RE_ACTION =
  /\b(open|opening|opens|launch|launched|expands|expansion|groundbreaking|ribbon\s+cutting|new\s+facility)\b/i;

/** POST /api/v1/leads/find-buyers  — discover & persist candidates */
router.post("/find-buyers", async (req, res) => {
  try {
    const region = String(req.body?.region || "usca").toLowerCase() as "us" | "ca" | "usca";

    // Broad query; we’ll filter locally with RE_ heuristics.
    const query =
      '("warehouse" OR "distribution center" OR "fulfillment center" OR "cold storage") + (open OR opening OR opens OR launch OR launched OR expands OR expansion OR groundbreaking OR "ribbon cutting" OR "new facility")';

    const raw = await collectNews({ region, query, limit: 50 });

    // Keep only relevant signals
    const kept = raw.filter((it: any) => {
      const t = `${it.title || ""} ${it.description || ""}`;
      return RE_FACILITY.test(t) && RE_ACTION.test(t);
    });

    const now = new Date().toISOString();

    const rows = kept.map((it: any) => {
      const title = it.title || "(untitled)";
      const text = `${title} ${it.description || ""}`.toLowerCase();
      const hot = /\b(open|opening|opens|launched|ribbon|groundbreaking)\b/.test(text);
      const host = String(it.domain || it.host || "news.google.com").replace(/^www\./, "");
      const id = `${host}::${title}`.slice(0, 200); // simple deterministic id

      return {
        id,
        host,
        title,
        created: now,
        temp: (hot ? "hot" : "warm") as const,
        why: {
          signal: {
            label: hot ? "Opening/launch signal" : "Expansion signal",
            score: hot ? 1 : 0.33,
            detail: title,
          },
          context: { label: "News (RSS)", detail: host },
        },
      };
    });

    // Persist for later GETs (survives restarts and multi-replica)
    saveLeads(rows);

    const hotN = rows.filter((x) => x.temp === "hot").length;
    const warmN = rows.length - hotN;

    return res.status(200).json({
      ok: true,
      created: rows.length,
      candidates: rows.map((x) => ({
        host: x.host,
        title: x.title,
        created: x.created,
        temperature: x.temp,
        why: x.why,
        whyText: x.why?.signal?.detail,
      })),
      message: `Candidates created. Hot:${hotN} Warm:${warmN}. Refresh lists to view.`,
      debug: { region, kept: kept.length, pulled: raw.length },
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

/** GET /api/v1/leads/ping-news  — quick sanity check in the browser */
router.get("/ping-news", async (req, res) => {
  try {
    const region = String(req.query.region || "usca").toLowerCase() as "us" | "ca" | "usca";
    const q = '("warehouse" OR "distribution center" OR "fulfillment center" OR "cold storage")';
    const sample = await collectNews({ region, query: q, limit: 10 });
    res.json({ ok: true, region, pulled: sample.length, sample: sample.slice(0, 5) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "ping failed" });
  }
});

export default router;