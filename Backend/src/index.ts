// backend/src/Index.ts
import express from "express";
import cors from "cors";
import crypto from "crypto";
import type { Request, Response } from "express";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* -------------------- Config -------------------- */
const ENV = {
  PORT: Number(process.env.PORT || 8080),
  FREE_FINDS_PER_DAY: Number(process.env.FREE_FINDS_PER_DAY || 2),
  FREE_REVEALS_PER_DAY: Number(process.env.FREE_REVEALS_PER_DAY || 2),
  PRO_FINDS_PER_DAY: Number(process.env.PRO_FINDS_PER_DAY || 40),
  PRO_REVEALS_PER_DAY: Number(process.env.PRO_REVEALS_PER_DAY || 120),
  DEMO_TOTAL_STEPS: 1126, // preview stream denominator
};

function todayUTC(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* -------------------- Types & store -------------------- */
type Quota = { date: string; findsUsed: number; revealsUsed: number };
type Traits = {
  vendorDomain?: string | null;
  regions?: string[];
  industries?: string[];
  buyers?: string[];
  notes?: string | null;
};
type User = {
  id: string;
  plan: "free" | "pro";
  email?: string;
  quota: Quota;
  traits: Traits;
  verified?: boolean; // cached result of domain match (email vs vendorDomain)
};
type Lead = {
  id: string;
  title: string;
  tags: string[];
  confidence: number;
  platform: string;
  createdAt: number;
};

const USERS = new Map<string, User>();
const LEAD_POOL = new Map<string, Lead[]>(); // per-user
let ONLINE = 0;

/* -------------------- Helpers -------------------- */
function uidFromReq(req: Request): string {
  return (req.header("x-galactly-user") || req.ip || "anon").slice(0, 120);
}
function resetIfNeeded(q: Quota) {
  const t = todayUTC();
  if (q.date !== t) {
    q.date = t;
    q.findsUsed = 0;
    q.revealsUsed = 0;
  }
}
function getOrInitUser(id: string): User {
  let u = USERS.get(id);
  if (!u) {
    u = {
      id,
      plan: "free",
      quota: { date: todayUTC(), findsUsed: 0, revealsUsed: 0 },
      traits: {},
      verified: false,
    };
    USERS.set(id, u);
  }
  resetIfNeeded(u.quota);
  // recompute verified if both sides present
  if (u.email && u.traits.vendorDomain) {
    const ed = emailDomain(u.email);
    const sd = bareHost(u.traits.vendorDomain);
    u.verified = !!(ed && sd && (ed === sd || ed.endsWith("." + sd)));
  }
  return u;
}
function bareHost(url?: string | null): string {
  if (!url) return "";
  return String(url)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}
function emailDomain(email?: string): string {
  if (!email) return "";
  const m = String(email).trim().toLowerCase().match(/^[^@]+@([^@]+)$/);
  return m ? m[1].replace(/^www\./, "") : "";
}
function planLimits(user: User) {
  const isPro = user.plan === "pro";
  const findsLimit = isPro ? ENV.PRO_FINDS_PER_DAY : ENV.FREE_FINDS_PER_DAY;
  // reveals: free users must be verified first
  const revealsBase = isPro ? ENV.PRO_REVEALS_PER_DAY : ENV.FREE_REVEALS_PER_DAY;
  const revealsLimit = user.plan === "free" && !user.verified ? 0 : revealsBase;
  return { findsLimit, revealsLimit };
}
function countsLeft(user: User) {
  const limits = planLimits(user);
  resetIfNeeded(user.quota);
  return {
    findsLeft: Math.max(0, limits.findsLimit - user.quota.findsUsed),
    revealsLeft: Math.max(0, limits.revealsLimit - user.quota.revealsUsed),
  };
}
function ensureLeadPool(user: User) {
  if (!LEAD_POOL.has(user.id)) {
    const now = Date.now();
    const platforms = ["reddit", "linkedin", "google", "procurement", "job-board", "pdp"];
    const sample: Lead[] = Array.from({ length: 14 }).map((_, i) => ({
      id: crypto.randomUUID(),
      title:
        i % 3 === 0
          ? "“Need 10k corrugate shippers (RSC)”"
          : i % 3 === 1
          ? "“Quote: 16oz cartons (retail)”"
          : "“Shrink film: 12u rolls — urgent”",
      tags: ["demand", i % 2 ? "ops" : "product"],
      confidence: 70 + Math.floor(Math.random() * 21),
      platform: platforms[i % platforms.length],
      createdAt: now - i * 3600_000,
    }));
    LEAD_POOL.set(user.id, sample);
  }
}

/* -------------------- Routes -------------------- */

// Basic health
app.get("/api/v1/healthz", (_req, res) => res.json({ ok: true }));

// Presence (very simple)
app.get("/presence/online", (_req, res) => {
  res.json({ total: ONLINE });
});

// Status: return plan, quotas, traits, and gate info
app.get("/api/v1/status", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const { findsLeft, revealsLeft } = countsLeft(u);
  res.json({
    ok: true,
    user: { id: u.id, plan: u.plan },
    quota: { findsLeft, revealsLeft, date: u.quota.date },
    gate: {
      email: u.email || null,
      domainMatch: !!u.verified,
    },
    traits: u.traits,
  });
});

// Gate: save email / region (best-effort)
app.post("/api/v1/gate", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const { email, region } = req.body || {};
  if (email) u.email = String(email).trim();
  if (region && !u.traits.regions) u.traits.regions = String(region)
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  // Verify immediately if vendorDomain already set
  if (u.email && u.traits.vendorDomain) {
    const ed = emailDomain(u.email);
    const sd = bareHost(u.traits.vendorDomain);
    u.verified = !!(ed && sd && (ed === sd || ed.endsWith("." + sd)));
  }
  res.json({ ok: true, verified: !!u.verified });
});

// Vault: store traits (and optionally verify if email present)
app.post("/api/v1/vault", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const { traits } = req.body || {};
  if (traits && typeof traits === "object") {
    const t: Traits = u.traits || {};
    if (typeof traits.vendorDomain === "string" && traits.vendorDomain.trim()) {
      t.vendorDomain = bareHost(traits.vendorDomain);
    }
    if (Array.isArray(traits.regions)) t.regions = traits.regions.filter(Boolean);
    if (Array.isArray(traits.industries)) t.industries = traits.industries.filter(Boolean);
    if (Array.isArray(traits.buyers)) t.buyers = traits.buyers.filter(Boolean);
    if (typeof traits.notes === "string") t.notes = traits.notes || null;
    u.traits = t;
  }
  // recompute verification
  if (u.email && u.traits.vendorDomain) {
    const ed = emailDomain(u.email);
    const sd = bareHost(u.traits.vendorDomain);
    u.verified = !!(ed && sd && (ed === sd || ed.endsWith("." + sd)));
  }
  res.json({ ok: true, traits: u.traits, verified: !!u.verified });
});

// Find-now: enforce quota, increment on success
app.post("/api/v1/find-now", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const { findsLeft } = countsLeft(u);

  if (findsLeft <= 0) {
    return res.status(200).json({ ok: false, reason: "quota", findsLeft: 0, created: 0 });
  }

  // Simulate collectors; increment counter
  u.quota.findsUsed += 1;
  ensureLeadPool(u);
  const created = Math.max(3, Math.floor(Math.random() * 6)); // pretend 3..8 new leads
  return res.json({
    ok: true,
    created,
    findsLeft: countsLeft(u).findsLeft,
  });
});

// Leads: return (rotated) deduped list
app.get("/api/v1/leads", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  ensureLeadPool(u);
  // rotate platforms as a very light “server rotates platforms”
  const list = (LEAD_POOL.get(u.id) || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  res.json({ ok: true, leads: list });
});

// Events: like/dislike/mute/confirm (stub)
app.post("/api/v1/events", (req, res) => {
  const id = uidFromReq(req);
  getOrInitUser(id); // ensure exists
  res.json({ ok: true });
});

// Claim/Own (stubs)
app.post("/api/v1/claim", (req, res) => res.json({ ok: true, reservedForSec: 120 }));
app.post("/api/v1/own", (req, res) => res.json({ ok: true }));

/* ---------- Signals Preview (SSE) ---------- */
type Tick = {
  category: string;
  lane: "free" | "pro";
  chain: string[];
  done: number;
  total: number;
  locked?: boolean;
};

const PREVIEW: Array<Pick<Tick, "category" | "chain">> = [
  { category: "Demand", chain: ["Ad libraries", "Probe", "Filter", "Conclusion"] },
  { category: "Product", chain: ["PDP deltas", "Probe", "Evidence", "Conclusion"] },
  { category: "Procurement", chain: ["Supplier portals", "Probe", "Evidence", "Conclusion"] },
  { category: "Retail", chain: ["Price cadence", "Probe", "Evidence", "Conclusion"] },
  { category: "Wholesale", chain: ["MOQ signals", "Probe", "Evidence", "Conclusion"] },
  { category: "Ops", chain: ["Job posts", "Probe", "Evidence", "Conclusion"] },
  { category: "Events", chain: ["Calendars", "Probe", "Evidence", "Conclusion"] },
  { category: "Reviews", chain: ["Public reviews", "Lexicon", "Evidence", "Conclusion"] },
  { category: "Timing", chain: ["If–then rules", "Probe", "Evidence", "Queue window"] },
];

app.get("/api/v1/progress.sse", (req: Request, res: Response) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const id = uidFromReq(req);
  const u = getOrInitUser(id);

  let total = ENV.DEMO_TOTAL_STEPS;
  let freeDone = 0;
  let proDone = 0;

  const send = (event: string, payload: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // slow, readable cadence
  let catIdx = 0;
  const timer = setInterval(() => {
    const def = PREVIEW[catIdx % PREVIEW.length];
    catIdx++;

    // Increment a small slice
    freeDone = Math.min(total, freeDone + Math.floor(total * 0.012) + 1);
    const freeTick: Tick = {
      category: def.category,
      lane: "free",
      chain: ["Probe", "Filter", "Evidence", "Conclusion"],
      done: freeDone,
      total,
    };
    send("tick", freeTick);

    // Pro shows extra checks (unlocked if plan is pro)
    const isPro = u.plan === "pro";
    proDone = Math.min(total, proDone + Math.floor(total * 0.018) + 2);
    const proTick: Tick = {
      category: def.category,
      lane: "pro",
      chain: ["Probe", "Filter", "Evidence", "Conclusion", "Auto-verify", "Queue window"],
      done: proDone,
      total,
      locked: !isPro,
    };
    send("tick", proTick);

    // Free halts early 50–80 items (upsell)
    if (freeDone >= Math.min(80, Math.floor(total * 0.07))) {
      send("halt", { freeDone, total, checkout: "/checkout/stripe?plan=pro" });
      clearInterval(timer);
      send("done", { ok: true });
    }
  }, 1200);

  req.on("close", () => clearInterval(timer));
});

/* -------------------- Presence counters -------------------- */
app.use((_req, _res, next) => {
  ONLINE = Math.max(0, ONLINE);
  next();
});

/* -------------------- Start -------------------- */
app.listen(ENV.PORT, () => {
  console.log(`API listening on :${ENV.PORT}`);
});
