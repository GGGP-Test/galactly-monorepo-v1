// Backend/src/routes/leads.ts
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
const mem = {
  hot: [] as Lead[],
  warm: [] as Lead[],
};
const MAX_KEEP = 300;
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

// Optional API key guard
router.use((req, res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need) return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
});

/** GET /api/v1/leads?temp=hot|warm — used by the Free Panel list refresh */
router.get("/", (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  if (temp !== "hot" && temp !== "warm")
    return res.status(400).json({ ok: false, error: "temp must be hot|warm" });
  return res.json({ ok: true, items: listLeads(temp as "hot" | "warm") });
});

/** GET /api/v1/leads/ping-news — quick adapter probe */
router.get("/ping-news", async (req, res) => {
  try {
    const region = String(req.query.region || "usca").toLowerCase() as "us" | "ca" | "usca";
    const q = (req.query.q as string) ||
      '(warehouse OR "distribution center" OR "fulfillment center" OR "cold storage") ' +
      '(open OR opening OR launch OR expands OR expansion OR ribbon OR groundbreaking)';
    const raw = await collectNews({ region, query: q, limit: 10 });
    return res.json({ ok: true, region, query: q, adapterCount: raw.length, sample: raw.slice(0, 5) });
  } catch (e: any) {
    console.error("[ping-news:error]", e?.stack || e);
    return res.status(500).json({ ok: false, error: e?.message || "ping failed" });
  }
});

/** POST /api/v1/leads/find-buyers — Panel action */
router.post("/find-buyers", async (req, res) => {
  try {
    const body = (req.body || {}) as { supplier?: string; region?: string; radiusMi?: number; persona?: any; };
    if (!body.supplier || body.supplier.length < 3) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    const region = String(body.region || "usca").toLowerCase() as "us" | "ca" | "usca";
    // v0 query for packaging-adjacent signals (we can specialize by persona later)
    const query =
      '(warehouse OR "distribution center" OR "fulfillment center" OR "cold storage") ' +
      '(open OR opening OR launch OR expands OR expansion OR ribbon OR groundbreaking)';

    const raw = await collectNews({ region, query, limit: 30 });

    let created = 0;
    const now = new Date();
    const candidates: Lead[] = [];

    for (const it of raw) {
      const title = it.title || "(untitled)";
      const text = `${title} ${it.description || ""}`.toLowerCase();
      const isHot = /\b(open|opening|launch|launched|grand opening|ribbon|groundbreaking)\b/.test(text);
      const temp: "hot" | "warm" = isHot ? "hot" : "warm";
      const host = it.domain || it.host || "news.google.com";

      const why = {
        signal: {
          label: isHot ? "Opening/launch signal" : "Expansion signal",
          score: isHot ? 1 : 0.33,
          detail: title,
        },
        context: { label: "News (RSS)", detail: host },
      };

      const lead: Lead = {
        id: `${host}::${title}`.slice(0, 200),
        host,
        title,
        created: now.toISOString(),
        temperature: temp,
        platform: "news",
        whyText: `${title} (${it.date || ""})`,
        why,
      };

      addLead(temp, lead);
      candidates.push(lead);
      created++;
    }

    return res.json({
      ok: true,
      created,
      candidates,
      message:
        created > 0
          ? "Candidates created from news signals. Use Refresh Hot/Warm to view."
          : "No current signals found (try region=US/CA and 100–250 mi).",
      debug: { region, query, adapterCount: raw.length },
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

export default router;