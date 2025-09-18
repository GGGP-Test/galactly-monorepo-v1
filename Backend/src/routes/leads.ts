// Backend/src/routes/leads.ts
import { Router } from "express";

// v0: call the news adapter directly so we can see end-to-end data flow.
// (Later we can swap back to your discovery/pipeline once we're happy.)
import { collectNews } from "../buyers/adapters/news"; // <- exists from previous work

// tiny in-memory store so the Free Panel's "Refresh Hot/Warm" has something to read
type Lead = {
  id: string;
  host: string;
  title: string;
  created: string;       // ISO
  temperature: "hot" | "warm";
  platform?: string;
  whyText?: string;
  why?: any;
};
const mem = {
  hot: [] as Lead[],
  warm: [] as Lead[],
};
const MAX_KEEP = 200;
function addLead(bucket: "hot" | "warm", lead: Lead) {
  const key = `${lead.host}::${lead.title}`;
  const dup = mem[bucket].find((x) => `${x.host}::${x.title}` === key);
  if (!dup) {
    mem[bucket].unshift(lead);
    if (mem[bucket].length > MAX_KEEP) mem[bucket].length = MAX_KEEP;
  }
}
function listLeads(bucket: "hot" | "warm") {
  return mem[bucket];
}

const router = Router();

// Optional API key guard (kept from your version)
router.use((req, res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need)
    return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
});

/**
 * GET /api/v1/leads
 *   ?temp=hot|warm
 * Used by the Free Panel's "Refresh Hot/Warm" buttons.
 */
router.get("/", async (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  if (temp !== "hot" && temp !== "warm")
    return res.status(400).json({ ok: false, error: "temp must be hot|warm" });

  return res.json({
    ok: true,
    items: listLeads(temp as "hot" | "warm"),
  });
});

/**
 * GET /api/v1/leads/ping-news
 * Quick health-check that the news adapter is callable.
 * Example: /api/v1/leads/ping-news?region=usca&q=warehouse%20opening
 */
router.get("/ping-news", async (req, res) => {
  try {
    const region = String(req.query.region || "usca").toLowerCase();
    const q = (req.query.q as string) || "warehouse OR distribution center";
    const items = await collectNews({ region, query: q, limit: 10 });

    return res.json({
      ok: true,
      region,
      query: q,
      count: items.length,
      sample: items.slice(0, 5),
    });
  } catch (e: any) {
    console.error("[ping-news:error]", e?.stack || e);
    return res.status(500).json({ ok: false, error: e?.message || "ping failed" });
  }
});

/**
 * POST /api/v1/leads/find-buyers
 * Body: { supplier, region, radiusMi, persona }
 *
 * v0 strategy:
 * - Use the news adapter to fetch signals in the chosen region
 * - Classify to hot/warm quickly (launch/opening -> hot; expansion -> warm)
 * - Store into the in-memory buckets so the list views can show them
 */
router.post("/find-buyers", async (req, res) => {
  try {
    const body = (req.body || {}) as {
      supplier?: string;   // domain like peekpackaging.com (captured for context; not yet used for search)
      region?: string;     // us|ca|usca
      radiusMi?: number;   // not used in v0
      persona?: any;       // not used in v0
    };

    // Basic validation
    if (!body.supplier || body.supplier.length < 3) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    const region = String(body.region || "usca").toLowerCase();

    // v0 keywords tuned for packaging-adjacent intent (can expand later)
    const query =
      '(warehouse OR "distribution center" OR "cold storage" OR "fulfillment center") ' +
      '(open OR opening OR launch OR expands OR expansion OR ribbon OR groundbreaking)';

    const news = await collectNews({ region, query, limit: 24 });

    // Map → leads; simple heuristics for temperature
    const now = new Date();
    let created = 0;
    const candidates: Array<Lead> = [];

    for (const it of news) {
      const title = it.title || it.headline || "(untitled)";
      const text = `${title} ${it.description || ""}`.toLowerCase();

      const isHot =
        /\b(open|opening|launch|launched|grand opening|ribbon|groundbreaking)\b/.test(
          text
        );
      const temp: "hot" | "warm" = isHot ? "hot" : "warm";

      const host = it.domain || it.host || "news.google.com";

      const lead: Lead = {
        id: `${host}::${title}`.slice(0, 200),
        host,
        title,
        created: now.toISOString(),
        temperature: temp,
        platform: "news",
        whyText: `${title} (${it.date || ""})`,
        why: {
          signal: {
            label: isHot ? "Opening/launch signal" : "Expansion signal",
            score: isHot ? 1 : 0.33,
            detail: title,
          },
          context: {
            label: "News (RSS)",
            detail: "news.google.com",
          },
        },
      };

      candidates.push(lead);
      addLead(temp, lead);
      created++;
    }

    return res.json({
      ok: true,
      created,
      candidates,
      message:
        created > 0
          ? "Candidates created from news signals. Use Refresh Hot/Warm to view."
          : "No current signals found. Try a wider radius/region or different supplier persona.",
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

export default router;