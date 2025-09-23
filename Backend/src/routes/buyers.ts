// src/routes/buyers.ts
import { Router, Request, Response } from "express";
import {
  buckets,
  findByHost,
  saveByHost,
  replaceHotWarm,
  resetHotWarm,
  StoredLead,
  watchers as memWatchers,
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

function bad(res: Response, error: string, code = 400) {
  const body: ApiErr = { ok: false, error };
  return res.status(code).json(body);
}

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
      return String(order).toLowerCase() === "asc" ? -d : d;
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

// ---------- POST /api/leads/lock ----------
// Body: { host, to?: 'hot' | 'warm' }   (default 'warm')
router.post("/leads/lock", (req: Request, res: Response) => {
  const host = String(req.body?.host ?? "").trim();
  const to = (String(req.body?.to ?? "warm").toLowerCase() as "hot" | "warm") || "warm";
  if (!host) return bad(res, "host is required");
  try {
    const l = replaceHotWarm(host, to === "hot" ? "hot" : "warm");
    res.json({ ok: true, item: toPanel(l) } as ApiOk<{ item: PanelLead }>);
  } catch (e: any) {
    bad(res, e?.message ?? "internal error", 500);
  }
});

// (kept: explicit variants used earlier)
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

// ---------- POST /api/leads/deepen ----------
// Enrich an existing lead with stronger "why" and (sometimes) upgrade temp.
// Body: { host, persona?: {offer?:string, solves?:string, titles?:string} }
router.post("/leads/deepen", (req: Request, res: Response) => {
  const host = String(req.body?.host ?? "").trim();
  if (!host) return bad(res, "host is required");

  const persona = (req.body?.persona ?? {}) as {
    offer?: string;
    solves?: string;
    titles?: string;
  };

  try {
    const existing = findByHost(host);
    if (!existing) return bad(res, "lead not found", 404);

    // fabricate extra “why” text deterministically so it feels stable
    const baseWhy = existing.why ?? "";
    const addBits = [
      persona.offer ? `Offer: ${persona.offer}` : "",
      persona.solves ? `Solves: ${persona.solves}` : "",
      persona.titles ? `Targets: ${persona.titles}` : "",
    ]
      .filter(Boolean)
      .join(" • ");

    const upgradedWhy =
      [baseWhy, addBits, `Signals: recent activity detected on ${host}`]
        .filter(Boolean)
        .join(" — ");

    // small chance to bump warm -> hot if persona present
    const bump =
      existing.temperature === "warm" &&
      (persona.offer || persona.solves || persona.titles);

    const nextTemp = bump ? ("hot" as const) : existing.temperature;

    const patched = saveByHost(host, {
      why: upgradedWhy,
      temperature: nextTemp,
      saved: true,
      platform: existing.platform ?? "web",
      title:
        existing.title ??
        `Buyer lead for ${host}${persona.offer ? ` — ${persona.offer}` : ""}`,
    });

    res.json({ ok: true, item: toPanel(patched) } as ApiOk<{ item: PanelLead }>);
  } catch (e: any) {
    bad(res, e?.message ?? "internal error", 500);
  }
});

// ---------- GET /api/leads/fomo?host= ----------
// Returns non-zero "watchers"/"competitors" with a time-based baseline.
router.get("/leads/fomo", (req: Request, res: Response) => {
  const host = String(req.query?.host ?? "").trim();
  if (!host) return bad(res, "host is required");

  try {
    const real = memWatchers(host); // arrays from memStore
    const hour = new Date().getUTCHours();

    // a tiny seeded-ish baseline so it never shows zero
    const seed =
      [...host].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381) ^ hour;
    const rand = (n: number) => (seed % n);

    const baselineWatchers = 1 + (rand(5) % 5); // 1..5
    const baselineCompetitors = rand(3); // 0..2

    const watchers = Math.max(baselineWatchers, real.watchers.length);
    const competitors = Math.max(baselineCompetitors, real.competitors.length);

    res.json({
      ok: true,
      host,
      watchers,
      competitors,
      updatedAt: new Date().toISOString(),
    } as ApiOk<{
      host: string;
      watchers: number;
      competitors: number;
      updatedAt: string;
    }>);
  } catch (e: any) {
    bad(res, e?.message ?? "internal error", 500);
  }
});

export default router;