// src/routes/context.ts
//
// Context + teaching loop for BV1:
// - POST /api/context/thumb         -> user feedback (thumbs up/down, band nudge)
// - GET  /api/context/prefs?host=   -> current effective prefs snapshot
// - POST /api/context/teach         -> suggest tokens (vertical/overlay/product/query)
// - GET  /api/context/suggest       -> aggregated suggestions (top-N)
// - POST /api/context/reset         -> admin: clear suggestions
//
// Notes:
// • No external deps. Emits events to /api/events/ingest so the admin panel shows activity.
// • Prefs writes are best-effort: if shared/prefs exposes setters we use them; else we just emit events.
// • Suggestions live in-memory per pod; treat them as a queue to review/commit.

import { Router, Request, Response } from "express";
import { requireAdmin } from "../shared/admin";
import { CFG } from "../shared/env";
import * as Prefs from "../shared/prefs";

/* ----------------------------- tiny utils --------------------------------- */

const F: (u: string, i?: any) => Promise<any> = (globalThis as any).fetch;

function s(v: unknown): string { return (v == null ? "" : String(v)).trim(); }
function lc(v: string): string { return v.toLowerCase(); }

function normHost(raw?: string): string | undefined {
  if (!raw) return;
  const h = s(raw).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return /^[a-z0-9.-]+$/.test(h) ? h : undefined;
}

async function emit(kind: string, data: any) {
  try {
    const url = `http://127.0.0.1:${CFG.port}/api/events/ingest`;
    await F(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, at: new Date().toISOString(), data }),
    });
  } catch { /* ignore */ }
}

/* ----------------------------- prefs helpers ------------------------------- */

const P: any = Prefs as any;

function getPrefs(host: string): Record<string, any> {
  try {
    return (
      (P.getPrefs && P.getPrefs(host)) ||
      (P.get && P.get(host)) ||
      {}
    ) || {};
  } catch { return {}; }
}

function patchPrefs(host: string, patch: Record<string, any>): boolean {
  try {
    if (P.patch) { P.patch(host, patch); return true; }
    if (P.setPrefs && P.getPrefs) { const cur = P.getPrefs(host) || {}; P.setPrefs(host, { ...cur, ...patch }); return true; }
    if (P.set && P.get) { const cur = P.get(host) || {}; P.set(host, { ...cur, ...patch }); return true; }
  } catch { /* ignore */ }
  return false;
}

/* ----------------------------- suggest store ------------------------------- */

type Kind = "vertical" | "overlay" | "product" | "query";
const MAX_TOKEN_LEN = 48;

function cleanToken(tok: string): string {
  const t = lc(s(tok)).replace(/[^a-z0-9 +\-_/&]/g, " ").replace(/\s+/g, " ").trim();
  return t.slice(0, MAX_TOKEN_LEN);
}

const SUGGEST = new Map<string, number>(); // key = kind|token

function bump(kind: Kind, token: string, w = 1) {
  const k = `${kind}|${token}`;
  SUGGEST.set(k, (SUGGEST.get(k) || 0) + Math.max(1, Math.floor(w)));
}

function topN(n = 100): Array<{ kind: Kind; token: string; count: number }> {
  const arr: Array<{ kind: Kind; token: string; count: number }> = [];
  for (const [k, v] of SUGGEST.entries()) {
    const [kind, token] = k.split("|", 2) as [Kind, string];
    arr.push({ kind, token, count: v });
  }
  arr.sort((a, b) => b.count - a.count);
  return arr.slice(0, Math.max(1, n));
}

function resetSuggest() { SUGGEST.clear(); }

/* ------------------------------- router ------------------------------------ */

const r = Router();

r.get("/ping", (_req, res) => res.json({ pong: true, at: new Date().toISOString() }));

// GET /api/context/prefs?host=example.com
r.get("/prefs", (req: Request, res: Response) => {
  const host = normHost(req.query.host as string);
  if (!host) return res.status(400).json({ ok: false, error: "bad_host" });
  const prefs = getPrefs(host);
  return res.json({ ok: true, host, prefs });
});

// POST /api/context/thumb
// { host, buyerHost?, up?:boolean, down?:boolean, band?:'HOT'|'WARM'|'COOL', tagsAdd?:string[], tagsRemove?:string[], notes? }
r.post("/thumb", async (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, any>;
  const host = normHost(body.host);
  if (!host) return res.status(400).json({ ok: false, error: "bad_host" });

  const buyerHost = normHost(body.buyerHost) || null;
  const up = !!body.up;
  const down = !!body.down;
  const band = s(body.band).toUpperCase();
  const notes = s(body.notes);

  const add = Array.isArray(body.tagsAdd) ? body.tagsAdd.map(cleanToken).filter(Boolean) : [];
  const rem = Array.isArray(body.tagsRemove) ? body.tagsRemove.map(cleanToken).filter(Boolean) : [];

  // best-effort prefs patch (grow likeTags; avoid duplicates)
  let patched = false;
  if (add.length || rem.length) {
    const cur = getPrefs(host);
    const like = new Set<string>(Array.isArray(cur.categoriesAllow) ? cur.categoriesAllow.map(cleanToken) : []);
    for (const t of add) like.add(t);
    for (const t of rem) like.delete(t);
    patched = patchPrefs(host, { categoriesAllow: Array.from(like).slice(0, 128) });
  }

  await emit("thumb", {
    userHost: host,
    buyerHost,
    up, down,
    band: band === "HOT" || band === "WARM" || band === "COOL" ? band : null,
    tagsAdd: add, tagsRemove: rem,
    notes,
    ip: req.ip || req.socket.remoteAddress || null,
  });

  return res.json({ ok: true, patchedPrefs: patched, suggestedAdds: add.length, suggestedRemoves: rem.length });
});

// POST /api/context/teach
// { kind:'vertical'|'overlay'|'product'|'query', tokens:string[], weight?:number }
r.post("/teach", requireAdmin, async (req: Request, res: Response) => {
  const kind = (s(req.body?.kind).toLowerCase() as Kind) || "overlay";
  const raw = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
  const w = Number(req.body?.weight ?? 1) || 1;

  const tokens = raw.map(cleanToken).filter(Boolean);
  if (!tokens.length) return res.status(400).json({ ok: false, error: "tokens_required" });

  for (const t of tokens) bump(kind, t, w);

  await emit("teach_tokens", { kind, tokens, weight: w });
  return res.json({ ok: true, added: tokens.length, kind });
});

// GET /api/context/suggest?limit=100
r.get("/suggest", (_req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(500, Number((_req.query?.limit as any) ?? 100)));
  return res.json({ ok: true, items: topN(limit) });
});

// POST /api/context/reset
r.post("/reset", requireAdmin, (_req: Request, res: Response) => {
  resetSuggest();
  return res.json({ ok: true, cleared: true });
});

export default r;