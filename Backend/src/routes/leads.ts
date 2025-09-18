import { Router } from "express";
import { collectNews } from "../buyers/adapters/news";
import { saveLeads, listLeads } from "../data/leads.db";

const router = Router();

/** Optional API key guard. If no key is set, this is a no-op. */
router.use((req, _res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need) return next(new Error("invalid api key"));
  next();
});

/** Prevent caching (avoid stale UI). */
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

/** Heuristics to identify relevant facility events. */
const RE_FACILITY =
  /\b(warehouse|distribution\s+center|distribution\s+centre|fulfillment\s+center|cold\s+storage)\b/i;
const RE_ACTION =
  /\b(open|opening|opens|launch|launched|expands|expansion|groundbreaking|ribbon\s+cutting|new\s+facility)\b/i;

function normalizeHost(v?: string) {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

function toRows(items: any[]) {
  const now = new Date().toISOString();
  return items.map((it: any) => {
    const title = it.title || "(untitled)";
    const text = `${title} ${it.description || ""}`.toLowerCase();
    const hot = /\b(open|opening|opens|launched|ribbon|groundbreaking)\b/.test(text);
    const host = normalizeHost(it.domain || it.host || "news.google.com");
    const id = `${host}::${title}`.slice(0, 200);
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
}

/** GET /api/v1/leads?temp=hot|warm
 * If DB has nothing (multi-replica issue), we lazily fetch, persist, and return items.
 */
router.get("/", async (req, res) => {
  try {
    const temp = String(req.query.temp || "warm").toLowerCase();
    if (temp !== "hot" && temp !== "warm") {
      return res.status(400).json({ ok: false, error: "temp must be hot|warm" });
    }

    let items = listLeads(temp as "hot" | "warm");
    if (items.length === 0) {
      // Lazy fallback: pull fresh news now so Refresh shows something.
      const region = String(req.query.region || "usca").toLowerCase() as "us" | "ca" | "usca";
      const q =
        '("warehouse" OR "distribution center" OR "fulfillment center" OR "cold storage") + (open OR opening OR opens OR launch OR launched OR expands OR expansion OR groundbreaking OR "ribbon cutting" OR "new facility")';
      const raw = await collectNews({ region, query: q, limit: 50 });
      const kept = raw.filter((it: any) => {
        const t = `${it.title || ""} ${it.description || ""}`;
        return RE_FACILITY.test(t) && RE_ACTION.test(t);
      });
      const rows = toRows(kept);
      saveLeads(rows);
      items = listLeads(temp as "hot" | "warm");
      return res.status(200).json({
        ok: true,
        count: items.length,
        items: items.map((r) => ({
          id: r.id,
          host: r.host,
          title: r.title,
          created: r.created,
          temperature: r.temp,
          why: r.why,
        })),
        lazyFilled: true,
      });
    }

    return res.status(200).json({
      ok: true,
      count: items.length,
      items: items.map((r) => ({
        id: r.id,
        host: r.host,
        title: r.title,
        created: r.created,
        temperature: r.temp,
        why: r.why,
      })),
      lazyFilled: false,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

/** POST /api/v1/leads/find-buyers — discover & persist candidates from news */
router.post("/find-buyers", async (req, res) => {
  try {
    const region = String(req.body?.region || "usca").toLowerCase() as "us" | "ca" | "usca";
    const query =
      '("warehouse" OR "distribution center" OR "fulfillment center" OR "cold storage") + (open OR opening OR opens OR launch OR launched OR expands OR expansion OR groundbreaking OR "ribbon cutting" OR "new facility")';

    const raw = await collectNews({ region, query, limit: 50 });
    const kept = raw.filter((it: any) => {
      const t = `${it.title || ""} ${it.description || ""}`;
      return RE_FACILITY.test(t) && RE_ACTION.test(t);
    });
    const rows = toRows(kept);
    saveLeads(rows);

    const hotN = rows.filter((x) => x.temp === "hot").length;
    const warmN = rows.length - hotN;

    return res.status(200).json({
      ok: true,
      created: rows.length,
      candidates: rows.map((x, i) => ({
        id: i + 1,
        host: x.host,
        title: x.title,
        created: x.created,
        temperature: x.temp,
        why: x.why,
        whyText: x.why?.signal?.detail,
        source: "news",
      })),
      message: `Candidates created. Hot:${hotN} Warm:${warmN}.`,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

/** GET /api/v1/leads/ping-news — quick sanity check */
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