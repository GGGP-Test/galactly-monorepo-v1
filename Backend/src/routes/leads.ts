// src/routes/leads.ts
import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import { runPipeline } from "../buyers/pipeline";

/**
 * This route implements:
 * - Tier A/B gating (by URL patterns + tokens)
 * - Confidence threshold (CONFIDENCE_MIN)
 * - Early-exit on N accepted results (EARLY_EXIT_FOUND / MAX_RESULTS_*)
 * - Short TTL cache (CACHE_TTL_S)
 * - Per-user cooldown + daily click quota (FREE/PRO_* envs)
 * - Per-host circuit breaker (HOST_CIRCUIT_FAILS / HOST_CIRCUIT_COOLDOWN_S)
 * - “Why?” snippet for each candidate so the UI can show credibility
 *
 * All knobs are env-driven; no other files need edits.
 */

// ---------- env knobs ----------
const ENV = {
  ALLOW_TIERS: (process.env.ALLOW_TIERS || "AB").toUpperCase(), // "AB" or "A" or "B"
  CONFIDENCE_MIN: num(process.env.CONFIDENCE_MIN, 0.72),
  EARLY_EXIT_FOUND: int(process.env.EARLY_EXIT_FOUND, 3),

  MAX_PROBES_PER_FIND_FREE: int(process.env.MAX_PROBES_PER_FIND_FREE, 20),
  MAX_PROBES_PER_FIND_PRO: int(process.env.MAX_PROBES_PER_FIND_PRO, 40),

  MAX_RESULTS_FREE: int(process.env.MAX_RESULTS_FREE, 3),
  MAX_RESULTS_PRO: int(process.env.MAX_RESULTS_PRO, 10),

  FREE_CLICKS_PER_DAY: int(process.env.FREE_CLICKS_PER_DAY, 2),
  FREE_COOLDOWN_MIN: int(process.env.FREE_COOLDOWN_MIN, 30),

  PRO_CLICKS_PER_DAY: int(process.env.PRO_CLICKS_PER_DAY, 20),

  CACHE_TTL_S: int(process.env.CACHE_TTL_S, 600),

  HOST_CIRCUIT_FAILS: int(process.env.HOST_CIRCUIT_FAILS, 5),
  HOST_CIRCUIT_COOLDOWN_S: int(process.env.HOST_CIRCUIT_COOLDOWN_S, 600),

  ENABLE_AUTO_TUNE: toBool(process.env.ENABLE_AUTO_TUNE, true),
};

function num(v: any, d: number) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function int(v: any, d: number) { const n = parseInt(String(v || ""), 10); return Number.isFinite(n) ? n : d; }
function toBool(v: any, d: boolean) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return d;
  return ["1","true","yes","on","y"].includes(s);
}

// ---------- tiny in-memory store (panel lists remain local here) ----------
type Temp = 'hot' | 'warm';
type StoredLead = {
  id: number;
  host: string;
  platform?: string;
  title: string;
  created: string;
  temperature: Temp;
  whyText?: string;
  why?: any;
};
let nextId = 1;
const panel: { hot: StoredLead[]; warm: StoredLead[] } = { hot: [], warm: [] };
function resetPanel() { panel.hot = []; panel.warm = []; nextId = 1; }

// ---------- per-user quota + cooldown (memory) ----------
type Usage = { day: string; clicks: number; lastAt?: number };
const usageByKey = new Map<string, Usage>();

// plan detection: if client sends x-plan: pro we treat as pro; else free
function detectPlan(req: any): "free"|"pro" {
  const plan = String(req.header("x-plan") || "").toLowerCase();
  return plan === "pro" ? "pro" : "free";
}
function identity(req: any): string {
  const api = req.header("x-api-key") || "";
  return api ? `key:${api}` : `ip:${req.ip || req.connection?.remoteAddress || "?"}`;
}
function canClickNow(req: any, plan: "free"|"pro"): { ok: true } | { ok: false, error: string, retryAfterS?: number } {
  const id = identity(req);
  const today = new Date().toISOString().slice(0,10);
  const u = usageByKey.get(id) || { day: today, clicks: 0 } as Usage;
  if (u.day !== today) { u.day = today; u.clicks = 0; u.lastAt = undefined; }
  const now = Date.now();

  const limit = plan === "pro" ? ENV.PRO_CLICKS_PER_DAY : ENV.FREE_CLICKS_PER_DAY;
  if (u.clicks >= limit) {
    return { ok: false, error: `daily limit reached (${limit})` };
  }
  if (plan === "free" && u.lastAt) {
    const cooldownMs = ENV.FREE_COOLDOWN_MIN * 60_000;
    const left = u.lastAt + cooldownMs - now;
    if (left > 0) {
      return { ok: false, error: `cooldown ${Math.ceil(left/1000)}s`, retryAfterS: Math.ceil(left/1000) };
    }
  }
  return { ok: true };
}
function noteClick(req: any) {
  const id = identity(req);
  const today = new Date().toISOString().slice(0,10);
  const u = usageByKey.get(id) || { day: today, clicks: 0 } as Usage;
  if (u.day !== today) { u.day = today; u.clicks = 0; }
  u.clicks += 1; u.lastAt = Date.now();
  usageByKey.set(id, u);
}

// ---------- short TTL cache ----------
type CacheVal = { expires: number; items: StoredLead[]; created: number };
const cache = new Map<string, CacheVal>();
function cacheKey(host: string, region: string, radiusMi: number, persona: any) {
  const p = persona ? JSON.stringify(persona).slice(0, 160) : "";
  return `${host}::${region}::${radiusMi}::${hash(p)}`;
}
function hash(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// ---------- per-host circuit breaker ----------
type Circuit = { fails: number; until?: number };
const blockedByHost = new Map<string, Circuit>();
function isBlocked(host: string): boolean {
  const c = blockedByHost.get(host);
  if (!c) return false;
  if (c.until && c.until > Date.now()) return true;
  if (c.until && c.until <= Date.now()) blockedByHost.delete(host);
  return false;
}
function noteFail(host: string) {
  const c = blockedByHost.get(host) || { fails: 0 } as Circuit;
  c.fails += 1;
  if (c.fails >= ENV.HOST_CIRCUIT_FAILS) {
    c.until = Date.now() + ENV.HOST_CIRCUIT_COOLDOWN_S * 1000;
    c.fails = 0; // reset after tripping
  }
  blockedByHost.set(host, c);
}
function noteOk(host: string) {
  blockedByHost.delete(host);
}

// ---------- Tier A/B gating helpers ----------
const PATH_RE = /(vendor|supplier|suppliers|procure|procurement|sourcing|purchasing|partners?|sell-?to|become-?a-?supplier|rfq|rfi)/i;
const TOKENS = [
  "become a supplier","new vendor","vendor registration","supplier registration",
  "procurement","sourcing","purchasing","rfq","rfi","packaging","labels","corrugated","carton","boxes"
];
const DISALLOW_HOSTS = [/^docs?\./i, /^help\./i, /^support\./i, /\.github\.io$/i];

function isTierAllowed(urlStr: string, allow: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (DISALLOW_HOSTS.some(re => re.test(host))) return false;
    // A: explicit vendor/supplier/procurement paths
    const pathHit = PATH_RE.test(u.pathname);
    // B: homepage or generic page but description/title tokens indicate vendor intake
    // (we’ll require token later from title/snippet; pathHit implies A-tier)
    if (allow === "A") return pathHit;
    if (allow === "B") return !pathHit; // B-tier = "soft" pages (handled later by token)
    if (allow === "AB") return true;
    return true;
  } catch { return false; }
}

function hasToken(s: string): { ok: boolean; hit?: string } {
  const L = (s || "").toLowerCase();
  for (const t of TOKENS) {
    if (L.includes(t)) return { ok: true, hit: t };
  }
  return { ok: false };
}

// ---------- router ----------
const router = Router();

// mini guard for write routes (optional)
router.use((req, res, next) => {
  (res as any).requireKey = () => {
    const need = process.env.API_KEY || process.env.X_API_KEY;
    if (!need) return true;
    const got = req.header("x-api-key");
    if (got !== need) {
      res.status(401).json({ ok: false, error: "invalid api key" });
      return false;
    }
    return true;
  };
  next();
});

// health
router.get("/ping", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// panel lists (still in-memory)
router.get("/", (req, res) => {
  const temp = String(req.query.temp || 'warm').toLowerCase();
  const items = temp === 'hot' ? panel.hot : panel.warm;
  res.json({ ok: true, items });
});

// core: find buyers (tier-gated, cached, quota’d)
router.post("/find-buyers", async (req, res) => {
  if (!(res as any).requireKey()) return;

  try {
    const plan = detectPlan(req);
    const can = canClickNow(req, plan);
    if (!can.ok) {
      const out: any = { ok: false, error: can.error };
      if (can.retryAfterS) (out as any).retryAfterS = can.retryAfterS;
      return res.status(429).json(out);
    }

    const body = (req.body || {}) as {
      supplier?: string;
      region?: string;
      radiusMi?: number;
      persona?: any;
      onlyUSCA?: boolean;
    };
    const supplier = (body.supplier || "").trim();
    if (!supplier || supplier.length < 3) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    // circuit-breaker per supplier host
    if (isBlocked(supplier)) {
      return res.status(503).json({ ok: false, error: "temporarily cooling this domain, try later" });
    }

    const region = (body.region || "US/CA").trim();
    const radiusMi = Math.max(1, Math.min(500, Number(body.radiusMi || 50)));

    // cache check
    const ckey = cacheKey(supplier, region, radiusMi, body.persona);
    const cval = cache.get(ckey);
    if (cval && cval.expires > Date.now()) {
      // return cached but also mirror into panel buckets so UI sees them
      mirrorToPanel(cval.items);
      noteClick(req);
      return res.json({
        ok: true,
        supplier,
        cached: true,
        created: cval.created,
        candidates: cval.items,
        message: `Returned ${cval.items.length} cached candidate(s).`
      });
    }

    // Discovery (still your function)
    const discovery = await runDiscovery({
      supplier,
      region,
      persona: (ENV.ENABLE_AUTO_TUNE && !body.persona) ? autoTunePersona(supplier) : body.persona
    });

    const excludeEnterprise = String(process.env.EXCLUDE_ENTERPRISE || 'true').toLowerCase() === 'true';

    // max probes hint (pipeline may ignore; we still do early-exit on our side)
    const maxProbes = (plan === "pro") ? ENV.MAX_PROBES_PER_FIND_PRO : ENV.MAX_PROBES_PER_FIND_FREE;

    const { candidates } = await runPipeline(discovery, {
      region: discovery ? (region || 'US/CA') : region,
      radiusMi,
      excludeEnterprise,
      maxProbes,
      confidenceMin: ENV.CONFIDENCE_MIN
    } as any);

    // Filter, score gate, and early exit
    const allow = ENV.ALLOW_TIERS;
    const maxResults = (plan === "pro") ? ENV.MAX_RESULTS_PRO : ENV.MAX_RESULTS_FREE;
    const out: StoredLead[] = [];

    for (const c of (candidates || [])) {
      const detail = c?.evidence?.[0]?.detail || {};
      const url: string = detail?.url || "";
      const title: string = detail?.title || "";
      const score: number = Number(c?.score ?? 0);

      if (!url) continue;
      if (score < ENV.CONFIDENCE_MIN) continue;
      if (!isTierAllowed(url, allow)) continue;

      const whyTok = hasToken(`${title} ${c?.snippet || ""}`);
      // Require path indicator for Tier A or token for Tier B cases.
      const pathIsA = PATH_RE.test(safePath(url));
      if (allow === "A" && !pathIsA) continue;
      if (allow === "B" && !whyTok.ok) continue;
      if (allow === "AB" && !pathIsA && !whyTok.ok) continue;

      const host = safeHost(url) || (c.domain || "unknown");
      const temp: Temp = (c.temperature === "hot" ? "hot" : "warm");

      const lead: StoredLead = {
        id: nextId++,
        host,
        platform: (c.source || "").startsWith("rss") ? "news" : "web",
        title: title || `Buyer lead for ${host}`,
        created: new Date().toISOString(),
        temperature: temp,
        whyText: title,
        why: {
          url,
          hit: whyTok.hit || (pathIsA ? "vendor-path" : undefined),
          score: Number(score.toFixed(2)),
          source: c.source || "unknown"
        }
      };

      out.push(lead);
      if (out.length >= Math.min(ENV.EARLY_EXIT_FOUND, maxResults)) break;
    }

    // If nothing acceptable came back, record a fail on this supplier host
    if (out.length === 0) {
      noteFail(supplier);
    } else {
      noteOk(supplier);
    }

    // Mirror to panel buckets and cache
    panel.hot = [];
    panel.warm = [];
    mirrorToPanel(out);

    cache.set(ckey, {
      expires: Date.now() + ENV.CACHE_TTL_S * 1000,
      items: out,
      created: out.length
    });

    noteClick(req);

    return res.json({
      ok: true,
      supplier: discovery?.supplierDomain || supplier,
      persona: discovery?.persona,
      latents: discovery?.latents,
      archetypes: discovery?.archetypes,
      candidates: out,
      cached: false,
      created: out.length,
      message: `Created ${out.length} candidate(s). (plan=${plan}, allow=${allow})`
    });

  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

// optional: clear in-memory panel & caches (key-protected)
router.post("/__clear", (req, res) => {
  if (!(res as any).requireKey()) return;
  resetPanel();
  cache.clear();
  res.json({ ok: true });
});

export default router;

// ---------- small helpers ----------
function safeHost(urlStr: string): string | undefined {
  try { return new URL(urlStr).hostname.replace(/^www\./, ""); } catch { return undefined; }
}
function safePath(urlStr: string): string {
  try { return new URL(urlStr).pathname || "/"; } catch { return "/"; }
}
function mirrorToPanel(items: StoredLead[]) {
  for (const m of items) {
    if (m.temperature === 'hot') panel.hot.push(m);
    else panel.warm.push(m);
  }
}
function autoTunePersona(_supplier: string) {
  // super light placeholder; leaves the pipeline compatibility intact
  return { vertical: "packaging", size: "mid", region: "US/CA", roles: ["procurement","packaging","sourcing"] };
}