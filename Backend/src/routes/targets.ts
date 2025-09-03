// src/routes/targets.ts
import { Router, Request, Response } from "express";
import type { Pool } from "pg";

/**
 * Bring-Your-List Intelligence (BYLI)
 * Pro-only: upload/manage target lists the engine will watch.
 *
 * Endpoints (mount at /api/v1/targets):
 *  - GET    /lists                                  -> summaries
 *  - POST   /lists                                  -> { name } => new list
 *  - GET    /list/:id/items?cursor=&limit=          -> paginated items
 *  - POST   /list/:id/bulk                          -> add items (csv/json/text)
 *  - DELETE /list/:id                               -> delete list
 *  - DELETE /item/:id                               -> delete a single item
 *  - POST   /validate                               -> quick domain validation/guess
 *
 * Auth: we try to resolve user by:
 *    1) req.userId (if your middleware sets it), or
 *    2) header x-user-id (number), or
 *    3) header x-user-email (we will upsert users row)
 *
 * Pro-only gate: users.plan = 'pro' OR plan_overrides.unlimited = true
 */

type Ctx = {
  db: Pool;
  config: {
    proListCap: number;       // max total targets per user (soft cap)
    maxLists: number;         // max lists per user
    defaultBulkLimit: number; // safety cap per bulk call
  };
};

export function createTargetsRouter(db: Pool, cfg?: Partial<Ctx["config"]>) {
  const router = Router();
  const ctx: Ctx = {
    db,
    config: {
      proListCap: Number(process.env.BYLI_PRO_TARGET_CAP || 100_000),
      maxLists: Number(process.env.BYLI_MAX_LISTS || 25),
      defaultBulkLimit: Number(process.env.BYLI_BULK_LIMIT || 10_000),
      ...cfg,
    },
  };

  // ---------- Helpers

  async function getUserId(req: Request): Promise<number> {
    // If your auth middleware already put req.userId, prefer that.
    const anyReq = req as any;
    if (typeof anyReq.userId === "number") return anyReq.userId;

    const idHeader = req.header("x-user-id");
    if (idHeader && /^\d+$/.test(idHeader)) return parseInt(idHeader, 10);

    const email = (req.header("x-user-email") || "").trim().toLowerCase();
    if (email) {
      const { rows } = await ctx.db.query(
        `insert into users(email) values ($1)
           on conflict (email) do update set updated_at = now()
         returning id`,
        [email]
      );
      return rows[0].id as number;
    }

    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }

  async function ensurePro(userId: number) {
    const q = await ctx.db.query(
      `select u.plan, coalesce(po.unlimited,false) as unlimited
         from users u
         left join plan_overrides po on po.user_id = u.id
        where u.id = $1`,
      [userId]
    );
    if (!q.rowCount) {
      throw Object.assign(new Error("unauthorized"), { status: 401 });
    }
    const { plan, unlimited } = q.rows[0] as { plan: string; unlimited: boolean };
    if (plan === "pro" || unlimited) return true;
    throw Object.assign(new Error("upgrade_required"), { status: 403, code: "upgrade_required" });
  }

  function normalizeDomain(raw: string): string | null {
    if (!raw) return null;
    let s = raw.trim().toLowerCase();
    s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
    s = s.replace(/\/.*$/, "");
    // very loose domain guard
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
    return s;
  }

  function parseBulkBody(req: Request): { items: { domain: string; label?: string; kind?: string }[] } {
    // Accept JSON: {items:[{domain,label,kind}...]}
    // or body as text/csv: "domain,label,kind\n.."
    const ctype = (req.headers["content-type"] || "").toString().toLowerCase();
    if (ctype.includes("application/json")) {
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : body;
      if (!Array.isArray(items)) return { items: [] };
      const out: { domain: string; label?: string; kind?: string }[] = [];
      for (const it of items) {
        if (!it) continue;
        const domain = normalizeDomain(String(it.domain || ""));
        if (!domain) continue;
        out.push({
          domain,
          label: it.label ? String(it.label).slice(0, 200) : undefined,
          kind: it.kind ? String(it.kind).slice(0, 30) : undefined,
        });
      }
      return { items: out };
    }

    // text/csv or text/plain
    const raw = String((req as any).rawBody || req.body || "").trim();
    if (!raw) return { items: [] };

    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items: { domain: string; label?: string; kind?: string }[] = [];
    for (const line of lines) {
      // csv: domain[,label[,kind]]
      const parts = line.split(",").map((p) => p.trim());
      const domain = normalizeDomain(parts[0] || "");
      if (!domain) continue;
      items.push({
        domain,
        label: parts[1] ? parts[1].slice(0, 200) : undefined,
        kind: parts[2] ? parts[2].slice(0, 30) : undefined,
      });
    }
    return { items };
  }

  function guessKind(domain: string): "buyer" | "supplier" | "unknown" {
    // Super-simple heuristic; we do real checks later in collectors.
    const d = domain.toLowerCase();
    const supplierHints = ["pack", "box", "carton", "corrugat", "film", "label", "tape", "shrink", "pouch", "foam"];
    const buyerHints = ["foods", "beverage", "drinks", "coffee", "tea", "snack", "candle", "cosmetic", "skincare"];
    if (supplierHints.some((k) => d.includes(k))) return "supplier";
    if (buyerHints.some((k) => d.includes(k))) return "buyer";
    return "unknown";
  }

  async function getUserTotals(userId: number) {
    const { rows } = await ctx.db.query(
      `select coalesce(sum(tl.total_targets),0)::int as total, count(*)::int as lists
         from target_lists tl where tl.user_id = $1`,
      [userId]
    );
    return rows[0] || { total: 0, lists: 0 };
  }

  // ---------- Routes

  // Summaries
  router.get("/lists", async (req: Request, res: Response) => {
    try {
      const userId = await getUserId(req);
      await ensurePro(userId);

      const q = await ctx.db.query(
        `select id, name, total_targets, created_at
           from target_lists
          where user_id = $1
          order by created_at desc`,
        [userId]
      );
      const totals = await getUserTotals(userId);
      res.json({ ok: true, lists: q.rows, totals });
    } catch (e: any) {
      res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code });
    }
  });

  // Create new list
  router.post("/lists", async (req: Request, res: Response) => {
    try {
      const userId = await getUserId(req);
      await ensurePro(userId);

      const name = String((req.body?.name || "My targets").toString()).slice(0, 200);
      const totals = await getUserTotals(userId);
      if (totals.lists >= ctx.config.maxLists) {
        return res.status(400).json({ ok: false, error: "max_lists_reached" });
      }

      const { rows } = await ctx.db.query(
        `insert into target_lists (user_id, name)
         values ($1, $2)
         returning id, name, total_targets, created_at`,
        [userId, name]
      );
      res.json({ ok: true, list: rows[0] });
    } catch (e: any) {
      res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code });
    }
  });

  // Paginated items
  router.get("/list/:id/items", async (req: Request, res: Response) => {
    try {
      const userId = await getUserId(req);
      await ensurePro(userId);
      const listId = Number(req.params.id);
      const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
      const cursor = Number(req.query.cursor || 0);

      // owner check
      const own = await ctx.db.query(`select 1 from target_lists where id=$1 and user_id=$2`, [listId, userId]);
      if (!own.rowCount) return res.status(404).json({ ok: false, error: "not_found" });

      const q = await ctx.db.query(
        `select id, domain, label, status, last_seen_signal, created_at
           from target_items
          where list_id = $1 and ($2 = 0 or id > $2)
          order by id asc
          limit $3`,
        [listId, cursor, limit]
      );
      const next = q.rows.length ? q.rows[q.rows.length - 1].id : null;
      res.json({ ok: true, items: q.rows, nextCursor: next });
    } catch (e: any) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  // Bulk add (json/csv/plain)
  router.post("/list/:id/bulk", async (req: Request, res: Response) => {
    try {
      const userId = await getUserId(req);
      await ensurePro(userId);

      const listId = Number(req.params.id);
      const own = await ctx.db.query(`select 1 from target_lists where id=$1 and user_id=$2`, [listId, userId]);
      if (!own.rowCount) return res.status(404).json({ ok: false, error: "not_found" });

      const { items } = parseBulkBody(req);
      if (!items.length) return res.status(400).json({ ok: false, error: "empty_payload" });

      // dedupe within payload
      const seen = new Set<string>();
      const toAdd = [];
      for (const it of items) {
        if (!it.domain) continue;
        if (seen.has(it.domain)) continue;
        seen.add(it.domain);
        toAdd.push(it);
        if (toAdd.length >= ctx.config.defaultBulkLimit) break;
      }

      // Enforce cap
      const totals = await getUserTotals(userId);
      if (totals.total + toAdd.length > ctx.config.proListCap) {
        return res.status(400).json({
          ok: false,
          error: "cap_exceeded",
          cap: ctx.config.proListCap,
          remaining: Math.max(0, ctx.config.proListCap - totals.total),
        });
      }

      let added = 0;
      let duplicates = 0;
      let bad = 0;

      // Insert with ON CONFLICT
      for (const it of toAdd) {
        const domain = it.domain;
        const label = it.label || null;
        const kind = (it.kind || guessKind(domain)) as string;

        try {
          const r = await ctx.db.query(
            `insert into target_items (list_id, domain, label, status)
             values ($1, $2, $3, 'new')
             on conflict (list_id, domain) do nothing`,
            [listId, domain, label]
          );
          if (r.rowCount) added++;
          else duplicates++;
        } catch {
          bad++;
        }
      }

      if (added) {
        await ctx.db.query(
          `update target_lists
              set total_targets = total_targets + $2
            where id = $1`,
          [listId, added]
        );
      }

      res.json({ ok: true, added, duplicates, bad });
    } catch (e: any) {
      res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code });
    }
  });

  // Delete list
  router.delete("/list/:id", async (req: Request, res: Response) => {
    try {
      const userId = await getUserId(req);
      await ensurePro(userId);
      const listId = Number(req.params.id);

      const own = await ctx.db.query(`select 1 from target_lists where id=$1 and user_id=$2`, [listId, userId]);
      if (!own.rowCount) return res.status(404).json({ ok: false, error: "not_found" });

      await ctx.db.query(`delete from target_lists where id=$1`, [listId]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  // Delete item
  router.delete("/item/:id", async (req: Request, res: Response) => {
    try {
      const userId = await getUserId(req);
      await ensurePro(userId);
      const itemId = Number(req.params.id);

      // verify ownership via list
      const own = await ctx.db.query(
        `select 1
           from target_items ti
           join target_lists tl on tl.id = ti.list_id
          where ti.id = $1 and tl.user_id = $2`,
        [itemId, userId]
      );
      if (!own.rowCount) return res.status(404).json({ ok: false, error: "not_found" });

      await ctx.db.query(`delete from target_items where id=$1`, [itemId]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  // Quick validator / preview before upload
  router.post("/validate", async (req: Request, res: Response) => {
    try {
      const userId = await getUserId(req); // we allow free users to *call* this, but…
      // …enforce pro when actually uploading. Keeping validator open helps upsell.

      const body = Array.isArray(req.body) ? req.body : req.body?.items || req.body || [];
      const rawItems: string[] = Array.isArray(body) ? body : [];
      const unique = new Set<string>();
      const out: any[] = [];

      for (const raw of rawItems.slice(0, 500)) {
        const domain = normalizeDomain(String(raw || ""));
        if (!domain) continue;
        if (unique.has(domain)) continue;
        unique.add(domain);

        const kind = guessKind(domain);
        const accepted = kind !== "unknown"; // simplistic; real checks are in collectors
        out.push({ domain, kind, accepted });
      }
      res.json({ ok: true, items: out });
    } catch (e: any) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

export default createTargetsRouter;
