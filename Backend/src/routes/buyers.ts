import { Router, Request, Response } from "express";
import { CFG } from "../shared/env";

const r = Router();
const F: (url: string, init?: any) => Promise<any> = (globalThis as any).fetch;

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

// Map UI query → leads service query
function toLeadsURL(q: Record<string, any>): string {
  const host = norm(q.host).toLowerCase();
  const city = norm(q.city);
  const minTier = norm(q.minTier).toUpperCase(); // optional A|B|C
  const limit = Number(q.count ?? q.limit ?? 0);

  const u = new URL(`http://127.0.0.1:${CFG.port}/api/leads/find-buyers`);
  if (host) u.searchParams.set("host", host);
  if (city) u.searchParams.set("city", city);
  if (minTier) u.searchParams.set("minTier", minTier);
  if (limit) u.searchParams.set("limit", String(limit));

  // pass-through (leads.ts may ignore today; safe)
  const sectors = norm(q.sectors);
  const tags = norm(q.tags);
  if (sectors) u.searchParams.set("sectors", sectors);
  if (tags) u.searchParams.set("tags", tags);

  return u.toString();
}

// Normalize items to the shape free-panel expects (defensive: keep originals)
function shapeItems(items: any[] = []) {
  return items.map((it) => {
    const host = norm(it.host);
    return {
      score: typeof it.score === "number" ? it.score : null,
      temp: it.temp ?? it.band ?? null,
      name: it.name || it.company || host || "-",
      host,
      url: it.url || (host ? `https://${host}` : undefined),
      why: it.why || Array.isArray(it.reasons) ? (it.reasons || []).slice(0, 6).join(" • ") : undefined,
      // keep originals too
      ...it,
    };
  });
}

// GET /api/buyers/find  (primary path used by the UI)
r.get("/find", async (req: Request, res: Response) => {
  try {
    const url = toLeadsURL(req.query as any);
    const resp = await F(url, { redirect: "follow" });
    const text = await resp.text();
    if (!resp.ok) return res.status(200).json({ ok: false, error: `proxy:${resp.status}`, detail: text.slice(0, 240) });

    let data: any = {};
    try { data = JSON.parse(text); } catch { /* not expected, but safe */ }

    if (data && data.items) data.items = shapeItems(data.items);
    return res.json(data);
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "buyers-find-failed", detail: String(err?.message || err) });
  }
});

// Alias used by some older builds: /api/buyers/search
r.get("/search", (req, res) => r.handle({ ...req, url: "/find" } as any, res));

// Super-short alias: /api/find  (free-panel tries this as a fallback)
const root = Router();
root.get("/", (req, res) => r.handle({ ...req, url: "/find" } as any, res));

export default r;
export const RootAlias = root;