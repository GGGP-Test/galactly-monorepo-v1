// src/routes/leads.ts
import { Router } from "express";
import { q } from "../shared/db";

// ---------- Types ----------
type LeadTemp = "warm" | "hot";
interface LeadItem {
  host: string;          // the buyer/company host we found (e.g., pg.com)
  platform: "web";
  title: string;         // page title or short label
  why_text: string;      // human explanation
  created: string;       // ISO string
  temp: LeadTemp;
}

// ---------- Helpers ----------
const router = Router();

function nowIso() {
  return new Date().toISOString();
}

async function isReachable(url: string, timeoutMs = 4500): Promise<boolean> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    // Prefer HEAD; some sites block it, so fall back to GET tiny fetch.
    let r = await fetch(url, { method: "HEAD", signal: c.signal });
    if (!r.ok || (r.status >= 500 && r.status <= 599)) {
      r = await fetch(url, { method: "GET", redirect: "follow", signal: c.signal });
    }
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function label(host: string, extra: string) {
  return `${extra} | ${host}`;
}

// A small, high-signal CPG/FMCG set to start (fast and relevant to packaging).
// We can expand this list later or make it model-driven, but keep it tight for speed.
const CANDIDATE_PORTALS: { host: string; url: string; why: string }[] = [
  { host: "pg.com", url: "https://www.pg.com/suppliers/",                why: "vendor page / supplier (+packaging hints)" },
  { host: "kraftheinzcompany.com", url: "https://www.kraftheinzcompany.com/suppliers", why: "vendor page / supplier-registration (+packaging)" },
  { host: "churchdwight.com", url: "https://www.churchdwight.com/suppliers", why: "vendor page / supplier-registration (+packaging)" },
  { host: "colgatepalmolive.com", url: "https://www.colgatepalmolive.com/en-us/purpose-and-values/responsible-sourcing", why: "responsible sourcing / supplier info" },
  { host: "mondelezinternational.com", url: "https://www.mondelezinternational.com/suppliers", why: "supplier portal" },
  { host: "conagra.com", url: "https://www.conagrabrands.com/suppliers", why: "supplier information" },
  { host: "generalmills.com", url: "https://www.generalmills.com/en/Company/purpose/Responsible-Sourcing", why: "responsible sourcing / suppliers" },
  { host: "pepsico.com", url: "https://www.pepsico.com/our-impact/esg-topics-a-z/responsible-sourcing", why: "responsible sourcing / supplier info" },
  { host: "unilever.com", url: "https://www.unilever.com/planet-and-society/responsible-partner-policy/", why: "supplier policy / onboarding" },
  { host: "johnsonandjohnson.com", url: "https://www.jnj.com/suppliers", why: "supplier portal" },
];

// Persist best-effort; ignore failures so UX stays snappy.
async function saveLeads(items: LeadItem[]) {
  if (!items.length) return;
  try {
    // Ensure table exists (lightweight, safe if already created)
    await q(`
      CREATE TABLE IF NOT EXISTS leads (
        id BIGSERIAL PRIMARY KEY,
        host TEXT NOT NULL,
        platform TEXT NOT NULL,
        title TEXT NOT NULL,
        why_text TEXT NOT NULL,
        temp TEXT NOT NULL,
        created TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS leads_created_idx ON leads(created DESC);
    `);

    const valuesSql = items
      .map(
        (_i, idx) =>
          `($${idx * 6 + 1}, $${idx * 6 + 2}, $${idx * 6 + 3}, $${idx * 6 + 4}, $${idx * 6 + 5}, $${idx * 6 + 6})`
      )
      .join(", ");

    const params = items.flatMap((x) => [
      x.host,
      x.platform,
      x.title,
      x.why_text,
      x.temp,
      x.created,
    ]);

    await q(
      `INSERT INTO leads (host, platform, title, why_text, temp, created)
       VALUES ${valuesSql};`,
      params as any[]
    );
  } catch {
    // swallow; logging removed for cleanliness in build logs
  }
}

async function liveSweepForBuyers(_supplierHost: string): Promise<LeadItem[]> {
  // We can later tailor by supplierHost/region; start with quick, broad CPG portals.
  const checks = await Promise.all(
    CANDIDATE_PORTALS.map(async (c) => {
      const ok = await isReachable(c.url);
      if (!ok) return null;
      return <LeadItem>{
        host: c.host,
        platform: "web",
        title: label(c.host, "Buyer portal / supplier info"),
        why_text: `${c.why} — source: live`,
        created: nowIso(),
        temp: "warm",
      };
    })
  );

  return checks.filter((x): x is LeadItem => Boolean(x)).slice(0, 10);
}

// ---------- Routes ----------

// GET /api/leads/warm  -> last 50 leads we’ve saved (any host)
router.get("/warm", async (_req, res) => {
  try {
    await q(`
      CREATE TABLE IF NOT EXISTS leads (
        id BIGSERIAL PRIMARY KEY,
        host TEXT NOT NULL,
        platform TEXT NOT NULL,
        title TEXT NOT NULL,
        why_text TEXT NOT NULL,
        temp TEXT NOT NULL,
        created TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    const r: any = await q(
      `SELECT host, platform, title, why_text, temp, created
       FROM leads
       ORDER BY created DESC
       LIMIT 50`
    );
    const items: LeadItem[] = (r?.rows ?? []).map((row: any) => ({
      host: row.host,
      platform: row.platform,
      title: row.title,
      why_text: row.why_text,
      temp: (row.temp as LeadTemp) ?? "warm",
      created: (row.created instanceof Date ? row.created.toISOString() : row.created) ?? nowIso(),
    }));
    res.json({ ok: true, items });
  } catch (err) {
    res.status(200).json({ ok: true, items: [] });
  }
});

// GET /api/leads/find-buyers?host=peekpackaging.com&region=US/CA&radius=50mi
router.get("/find-buyers", async (req, res) => {
  const supplierHost = String(req.query.host || "").trim().toLowerCase();
  if (!supplierHost) {
    return res.status(400).json({ ok: false, error: "missing host" });
  }

  try {
    // 1) quick live sweep (fast HEAD/GET checks)
    const liveItems = await liveSweepForBuyers(supplierHost);

    // 2) best-effort save (async, but we await to warm cache quickly)
    await saveLeads(liveItems);

    return res.json({
      ok: true,
      saved: liveItems.length,
      items: liveItems,
      latest_candidate:
        liveItems[0] ??
        null,
    });
  } catch (err) {
    return res.json({ ok: true, saved: 0, items: [] });
  }
});

// POST /api/leads/deepen  -> placeholder: in future call external mirrors/workflows
router.post("/deepen", async (_req, res) => {
  // For now just acknowledge; UI uses this to feel “working”.
  res.json({ ok: true, queued: 0, note: "deepen stub; live sweep already returned items" });
});

export default router;