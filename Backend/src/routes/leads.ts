// Backend/src/routes/leads.ts
import { Router, Request, Response } from "express";
import { q } from "../shared/db";

// --- types we use on the wire ---
type Temp = "cold" | "warm" | "hot";
interface LeadItem {
  host: string;
  platform: string;
  title?: string;
  why?: string;
  temp?: Temp;
  created?: string;
  source_url?: string;
}

export const router = Router();

/**
 * POST /api/ingest/github
 * Accepts items from GitHub Actions (mirror/ingest). Upserts into lead_pool.
 * Body: { items: LeadItem[] }
 */
router.post(
  "/ingest/github",
  async (req: Request<unknown, unknown, { items?: LeadItem[] }>, res: Response) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      let saved = 0;
      for (const it of items) {
        if (!it?.host) continue;
        const host = String(it.host).toLowerCase().trim();
        const platform = it.platform || "web";
        const title = it.title || null;
        const why = it.why || (it as any).whyText || null;
        const temp: Temp = (it.temp as Temp) || "warm";
        const created = it.created ? new Date(it.created) : new Date();
        const src = it.source_url || null;

        await q(
          `INSERT INTO lead_pool (host, platform, title, why, temp, created, source_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (source_url) DO UPDATE
           SET host=EXCLUDED.host, platform=EXCLUDED.platform, title=COALESCE(EXCLUDED.title, lead_pool.title),
               why=COALESCE(EXCLUDED.why, lead_pool.why), temp=EXCLUDED.temp`,
          [host, platform, title, why, temp, created, src]
        );
        saved++;
      }
      res.json({ ok: true, saved });
    } catch (err: any) {
      console.error("ingest/github failed", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  }
);

/**
 * GET /api/leads/warm?host=peekpackaging.com
 * Returns recent warm/hot leads we have for this host (persisted).
 */
router.get(
  "/leads/warm",
  async (req: Request<unknown, unknown, unknown, { host?: string; limit?: string }>, res: Response) => {
    const host = (req.query.host || "").toLowerCase().trim();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 25)));
    try {
      const rows = host
        ? await q<LeadItem>(
            `SELECT host, platform, title, why, temp, created, source_url
             FROM lead_pool
             WHERE host=$1
             ORDER BY created DESC
             LIMIT $2`,
            [host, limit]
          )
        : await q<LeadItem>(
            `SELECT host, platform, title, why, temp, created, source_url
             FROM lead_pool
             ORDER BY created DESC
             LIMIT $1`,
            [limit]
          );
      res.json({ ok: true, items: rows.rows });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  }
);

/**
 * GET /api/leads/find-buyers?host=peekpackaging.com&region=US/CA&radius=50
 * Fast "first hit" – returns 1..n candidates by probing a few canonical paths.
 * This is the < 1 minute path the panel uses after user clicks Find.
 */
router.get(
  "/leads/find-buyers",
  async (req: Request<unknown, unknown, unknown, { host?: string }>, res: Response) => {
    const host = (req.query.host || "").toLowerCase().trim();
    if (!host) return res.status(400).json({ ok: false, error: "host required" });

    // tiny heuristic sweep (fast)
    const CANDIDATE_PATHS = [
      "/", "/vendor", "/vendors", "/supplier", "/suppliers",
      "/procurement", "/purchasing", "/partner", "/partners", "/rfq"
    ];
    const USER_AGENT = "GalactlyBot/0.1 (+https://galactly.dev)";

    const hits: LeadItem[] = [];
    const controller = new AbortController();

    async function tryFetch(path: string) {
      const url = `https://${host}${path}`;
      try {
        const r = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers: { "user-agent": USER_AGENT },
          signal: controller.signal as any,
        } as any);
        if (!r.ok) return;
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("text/html")) return;
        const html = (await r.text()).slice(0, 150_000).toLowerCase();
        const score =
          (html.includes("vendor") ? 1 : 0) +
          (html.includes("supplier") ? 1 : 0) +
          (html.includes("procurement") ? 1 : 0) +
          (html.includes("packaging") ? 2 : 0);
        if (score >= 2) {
          const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
          hits.push({
            host,
            platform: "web",
            title: titleMatch?.[1]?.trim() || `Possible buyer @ ${host}`,
            why: `vendor page / supplier (+packaging hints) — source: live`,
            temp: "warm",
            source_url: url,
          });
        }
      } catch { /* ignore */ }
    }

    // probe a handful of paths quickly (in parallel)
    await Promise.all(CANDIDATE_PATHS.slice(0, 6).map(tryFetch));

    // Persist any hits for future refreshes
    for (const h of hits) {
      await q(
        `INSERT INTO lead_pool (host, platform, title, why, temp, source_url)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (source_url) DO NOTHING`,
        [h.host, h.platform, h.title, h.why, h.temp || "warm", h.source_url]
      );
    }

    res.json({ ok: true, items: hits });
  }
);

/**
 * POST /api/leads/deepen
 * Body: { host: string }
 * Slower pass: broadens paths and packs more into DB for that host.
 */
router.post(
  "/leads/deepen",
  async (req: Request<unknown, unknown, { host?: string }>, res: Response) => {
    const host = (req.body?.host || "").toLowerCase().trim();
    if (!host) return res.status(400).json({ ok: false, error: "host required" });

    const MORE_PATHS = [
      "/supplier-registration", "/vendor-registration",
      "/sourcing", "/supply", "/purchasing", "/purchase",
      "/terms/vendor", "/terms/supplier"
    ];

    let created = 0;
    await Promise.all(
      MORE_PATHS.map(async (p) => {
        const url = `https://${host}${p}`;
        try {
          const r = await fetch(url, { headers: { "user-agent": "GalactlyBot/0.1" } } as any);
          if (!r.ok) return;
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          if (!ct.includes("text/html")) return;
          const html = (await r.text()).slice(0, 200_000).toLowerCase();
          if (html.includes("supplier") || html.includes("vendor")) {
            await q(
              `INSERT INTO lead_pool (host, platform, title, why, temp, source_url)
               VALUES ($1,'web',$2,$3,'warm',$4)
               ON CONFLICT (source_url) DO NOTHING`,
              [
                host,
                `Possible buyer @ ${host}`,
                "from deeper live sweep",
                url,
              ]
            );
            created++;
          }
        } catch { /* ignore */ }
      })
    );

    res.json({ ok: true, created });
  }
);