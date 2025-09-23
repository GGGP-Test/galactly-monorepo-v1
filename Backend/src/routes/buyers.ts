// src/routes/buyers.ts
import { Router, Request, Response } from "express";
import {
  buckets,
  findByHost,
  saveByHost,
  replaceHotWarm,
  resetHotWarm,
  StoredLead,
} from "../shared/memStore";

const router = Router();

// ---- shapes the panel understands ----
type PanelLead = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;
  temp?: "hot" | "warm" | "cold" | string;
  whyText?: string;
};

type ApiOk<T = unknown> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

// map internal lead -> panel lead
function toPanel(l: StoredLead): PanelLead {
  return {
    host: l.host,
    platform: l.platform ?? "web",
    title: l.title ?? `Buyer lead for ${l.host}`,
    created: l.created,
    temp: l.temperature,
    whyText: l.why,
  };
}

function bad(res: Response, error: string, code = 400) {
  const body: ApiErr = { ok: false, error };
  return res.status(code).json(body);
}

// ---------- GET /api/leads/summary ----------
router.get("/leads/summary", (_req, res) => {
  try {
    const b = buckets();
    const all = [...b.hot, ...b.warm, ...b.cold];
    const saved = all.reduce((n, x) => (x.saved ? n + 1 : n), 0);

    const body: ApiOk<{
      summary: {
        total: number;
        hot: number;
        warm: number;
        cold: number;
        saved: number;
        updatedAt: string;
      };
    }> = {
      ok: true,
      summary: {
        total: all.length,
        hot: b.hot.length,
        warm: b.warm.length,
        cold: b.cold.length,
        saved,
        updatedAt: new Date().toISOString(),
      },
    };
    res.json(body);
  } catch (e: any) {
    bad(res, e?.message ?? "internal error", 500);
  }
});

// ---------- GET /api/leads/list ----------
// Optional query: temp=(hot|warm|cold|all) page=1 size=50 order=(desc|asc)
router.get("/leads/list", (req: Request, res: Response) => {
  try {
    const { temp = "all", page = "1", size = "50", order = "desc" } = req.query;

    const b = buckets();
    let pool =
      temp === "hot"
        ? b.hot
        : temp === "warm"
        ? b.warm
        : temp === "cold"
        ? b.cold
        : [...b.hot, ...b.warm, ...b.cold];

    // sort by created time (fallback: keep insertion)
    pool = [...pool].sort((a, b) => {
      const ta = Date.parse(a.created ?? "");
      const tb = Date.parse(b.created ?? "");
      const d = (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
      return order === "asc" ? -d : d;
    });

    const p = Math.max(1, parseInt(String(page), 10) || 1);
    const s = Math.max(1, Math.min(500, parseInt(String(size), 10) || 50));
    const start = (p - 1) * s;
    const items = pool.slice(start, start + s).map(toPanel);

    const body: ApiOk<{
      items: PanelLead[];
      page: number;
      size: number;
      total: number;
    }> = { ok: true, items, page: p, size: s, total: pool.length };

    res.json(body);
  } catch (e: any) {
    bad(res, e?.message ?? "internal error", 500);
  }
});

// ---------- POST /api/leads/lock-hot ----------
router.post("/leads/lock-hot", (req: Request, res: Response) => {
  const host = String(req.body?.host ?? "").trim();
  if (!host) return bad(res, "host is required");
  try {
    const l = replaceHotWarm(host, "hot");
    res.json({ ok: true, item: toPanel(l) } as ApiOk<{ item: PanelLead }>);
  } catch (e: any) {
    bad(res, e?.message ?? "internal error", 500);
  }
});

// ---------- POST /api/leads/lock-warm ----------
router.post("/leads/lock-warm", (req: Request, res: Response) => {
  const host = String(req.body?.host ?? "").trim();
  if (!host) return bad(res, "host is required");
  try {
    const l = replaceHotWarm(host, "warm");
    res.json({ ok: true, item: toPanel(l) } as ApiOk<{ item: PanelLead }>);
  } catch (e: any) {
    bad(res, e?.message ?? "internal error", 500);
  }
});

// ---------- POST /api/leads/reset ----------
router.post("/leads/reset", (req: Request, res: Response) => {
  const host = String(req.body?.host ?? "").trim();
  if (!host) return bad(res, "host is required");
  try {
    const l = resetHotWarm(host);
    res.json({ ok: true, item: toPanel(l) } as ApiOk<{ item: PanelLead }>);
  } catch (e: any) {
    bad(res, e?.message ?? "internal error", 500);
  }
});

// ---------- POST /api/leads/save ----------
// Body: { host, title?, platform?, why?, temperature? }
router.post("/leads/save", (req: Request, res: Response) => {
  const host = String(req.body?.host ?? "").trim();
  if (!host) return bad(res, "host is required");

  try {
    const patch: Partial<StoredLead> = {
      title: req.body?.title,
      platform: req.body?.platform,
      why: req.body?.why,
      temperature: req.body?.temperature,
      saved: true,
    };
    const l = saveByHost(host, patch);
    res.json({ ok: true, item: toPanel(l) } as ApiOk<{ item: PanelLead }>);
  } catch (e: any) {
    bad(res, e?.message ?? "internal error", 500);
  }
});

// ---------- GET /api/leads/get?host= ----------
router.get("/leads/get", (req: Request, res: Response) => {
  const host = String(req.query?.host ?? "").trim();
  if (!host) return bad(res, "host is required");
  const l = findByHost(host);
  if (!l) return bad(res, "not found", 404);
  res.json({ ok: true, item: toPanel(l) } as ApiOk<{ item: PanelLead }>);
});

export default router;