// src/routes/inbound.ts
//
// Simple in-memory directory of suppliers who opt in to receive inbound buyer interest.
// Backed by shared/prefs so a host’s status lives in one place, but this router
// keeps a lightweight index for fast listing/filtering.
//
// Endpoints
// ---------
// GET  /api/inbound/ping
// GET  /api/inbound                 -> list entries (filters: city, titles, materials, certs, q, limit)
// GET  /api/inbound/:host           -> single entry snapshot (reads prefs)
// POST /api/inbound/opt-in          -> { host, ...optional fields }  (persists to prefs + index)
// POST /api/inbound/opt-out         -> { host }                      (persists to prefs + index)
// POST /api/inbound/sync            -> { host }                      (ensure index reflects prefs)
// POST /api/inbound/reindex         -> { hosts: string[] }           (bulk sync from prefs)
//
// Notes
// -----
// * No external deps. Everything is deterministic.
// * Index is ephemeral (in-memory). Prefs remain the source of truth.
// * Filters are case-insensitive and tolerant to partial matches.

import { Router, Request, Response } from "express";
import {
  getPrefs,
  setPrefs,
  normalizeHost as normHostShared,
  type EffectivePrefs,
} from "../shared/prefs";

const r = Router();

/* -------------------------------------------------------------------------- */
/* Types & helpers                                                            */
/* -------------------------------------------------------------------------- */

type InboundEntry = {
  host: string;
  city?: string;
  titlesPreferred?: string[];
  materialsAllow?: string[];
  materialsBlock?: string[];
  certsRequired?: string[];
  keywordsAdd?: string[];
  keywordsAvoid?: string[];
  categoriesAllow?: string[]; // mirror from prefs for easy matching
  inboundOptIn: boolean;
  updatedAt: string; // ISO
  createdAt: string; // ISO (first time we saw it opt in)
};

function nowIso() { return new Date().toISOString(); }
function normHost(h?: string) { return normHostShared(String(h || "")); }
function lowerCleanList(v: unknown): string[] {
  const out = new Set<string>();
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = String(x || "").trim().toLowerCase();
      if (s) out.add(s);
    }
  }
  return [...out];
}
function hasAny(hay: string[] | undefined, needles: string[]): boolean {
  if (!hay || hay.length === 0 || needles.length === 0) return true; // treat as pass
  const set = new Set(hay.map(s => s.toLowerCase()));
  return needles.some(n => set.has(n.toLowerCase()));
}
function includesFuzzy(hay: string | undefined, q: string | undefined): boolean {
  if (!q) return true;
  if (!hay) return false;
  const a = hay.toLowerCase();
  const b = q.toLowerCase();
  return a.includes(b);
}

/* -------------------------------------------------------------------------- */
/* In-memory index (ephemeral)                                                */
/* -------------------------------------------------------------------------- */

const INDEX = new Map<string, InboundEntry>(); // host -> entry

function snapshotFromPrefs(host: string, prefs: EffectivePrefs, existing?: InboundEntry): InboundEntry {
  const createdAt = existing?.createdAt || nowIso();
  return {
    host,
    city: prefs.city || undefined,
    titlesPreferred: Array.isArray((prefs as any).titlesPreferred) ? (prefs as any).titlesPreferred : existing?.titlesPreferred || [],
    materialsAllow: Array.isArray((prefs as any).materialsAllow) ? (prefs as any).materialsAllow : existing?.materialsAllow || [],
    materialsBlock: Array.isArray((prefs as any).materialsBlock) ? (prefs as any).materialsBlock : existing?.materialsBlock || [],
    certsRequired: Array.isArray((prefs as any).certsRequired) ? (prefs as any).certsRequired : existing?.certsRequired || [],
    keywordsAdd: Array.isArray((prefs as any).keywordsAdd) ? (prefs as any).keywordsAdd : existing?.keywordsAdd || [],
    keywordsAvoid: Array.isArray((prefs as any).keywordsAvoid) ? (prefs as any).keywordsAvoid : existing?.keywordsAvoid || [],
    categoriesAllow: Array.isArray((prefs as any).categoriesAllow) ? (prefs as any).categoriesAllow : existing?.categoriesAllow || [],
    inboundOptIn: (prefs as any).inboundOptIn === true,
    createdAt,
    updatedAt: nowIso(),
  };
}

function ensureIndexed(host: string): InboundEntry | null {
  const prefs = getPrefs(host);
  const entry = snapshotFromPrefs(host, prefs, INDEX.get(host));
  if (entry.inboundOptIn) {
    INDEX.set(host, entry);
    return entry;
  } else {
    INDEX.delete(host);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

r.get("/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, at: nowIso(), indexed: INDEX.size });
});

// Directory list with basic filters
// GET /api/inbound?city=...&titles=ops,procurement&materials=paper,film&certs=fda,gmp&q=shrink&limit=50
r.get("/", (req: Request, res: Response) => {
  const cityQ       = String(req.query.city || "").trim();
  const titlesQ     = lowerCleanList(String(req.query.titles || "").split(/[;,]/).map(s=>s.trim()).filter(Boolean));
  const materialsQ  = lowerCleanList(String(req.query.materials || "").split(/[;,]/).map(s=>s.trim()).filter(Boolean));
  const certsQ      = lowerCleanList(String(req.query.certs || "").split(/[;,]/).map(s=>s.trim()).filter(Boolean));
  const q           = String(req.query.q || "").trim();
  const limit       = Math.max(1, Math.min(500, Number(req.query.limit || 50)));

  const rows = Array.from(INDEX.values())
    .filter(e => e.inboundOptIn === true)
    .filter(e => includesFuzzy(e.city, cityQ))
    .filter(e => hasAny(e.titlesPreferred, titlesQ))
    .filter(e => {
      const have = lowerCleanList([...(e.materialsAllow || []), ...(e.categoriesAllow || [])]);
      return hasAny(have, materialsQ);
    })
    .filter(e => hasAny(e.certsRequired, certsQ))
    .filter(e => {
      if (!q) return true;
      const blob = [
        e.host, e.city,
        ...(e.titlesPreferred || []),
        ...(e.materialsAllow || []),
        ...(e.categoriesAllow || []),
        ...(e.certsRequired || []),
        ...(e.keywordsAdd || [])
      ].join(" ").toLowerCase();
      return blob.includes(q.toLowerCase());
    })
    .slice(0, limit);

  res.json({ ok: true, total: rows.length, items: rows });
});

// Single entry snapshot (fresh from prefs; also refresh index)
r.get("/:host", (req: Request, res: Response) => {
  const host = normHost(req.params.host);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });
  const entry = ensureIndexed(host);
  const prefs = getPrefs(host);
  res.json({
    ok: true,
    host,
    inboundOptIn: (prefs as any).inboundOptIn === true,
    entry: entry || null,
    prefs,
  });
});

// Opt-in (persist to prefs + index)
r.post("/opt-in", (req: Request, res: Response) => {
  const body = req.body || {};
  const host = normHost(body.host);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });

  const patch: any = {
    inboundOptIn: true,
  };

  // Optional structured hints
  if (Array.isArray(body.titlesPreferred)) patch.titlesPreferred = body.titlesPreferred;
  if (Array.isArray(body.materialsAllow))  patch.materialsAllow  = body.materialsAllow;
  if (Array.isArray(body.materialsBlock))  patch.materialsBlock  = body.materialsBlock;
  if (Array.isArray(body.certsRequired))   patch.certsRequired   = body.certsRequired;
  if (Array.isArray(body.keywordsAdd))     patch.keywordsAdd     = body.keywordsAdd;
  if (Array.isArray(body.keywordsAvoid))   patch.keywordsAvoid   = body.keywordsAvoid;

  const prefs = setPrefs(host, patch);
  const entry = ensureIndexed(host);
  res.json({ ok: true, host, inboundOptIn: true, entry, prefs });
});

// Opt-out (persist to prefs + index)
r.post("/opt-out", (req: Request, res: Response) => {
  const body = req.body || {};
  const host = normHost(body.host);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });

  const prefs = setPrefs(host, { inboundOptIn: false } as any);
  INDEX.delete(host);
  res.json({ ok: true, host, inboundOptIn: false, prefs });
});

// Ensure index reflects prefs for a host (useful after /prefs/upsert)
r.post("/sync", (req: Request, res: Response) => {
  const body = req.body || {};
  const host = normHost(body.host);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });
  const entry = ensureIndexed(host);
  res.json({ ok: true, host, synced: true, indexed: Boolean(entry), entry: entry || null });
});

// Bulk reindex from prefs for a set of hosts
r.post("/reindex", (req: Request, res: Response) => {
  const hosts = Array.isArray(req.body?.hosts) ? req.body.hosts : [];
  const clean = hosts.map((h: string) => normHost(h)).filter(Boolean);
  let added = 0, removed = 0;
  for (const h of clean) {
    const prefs = getPrefs(h);
    const before = INDEX.has(h);
    const entry = ensureIndexed(h);
    const after = INDEX.has(h);
    if (!before && after) added++;
    if (before && !after) removed++;
  }
  res.json({ ok: true, processed: clean.length, added, removed, indexedSize: INDEX.size });
});

export default r;