// backend/src/Index.ts
import express from "express";
import crypto from "crypto";
import type { Request, Response } from "express";

const app = express();

/* -------------------- Minimal CORS (no package) -------------------- */
app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin as string);
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-galactly-user"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

/* -------------------- Config -------------------- */
const ENV = {
  PORT: Number(process.env.PORT || 8080),
  FREE_FINDS_PER_DAY: Number(process.env.FREE_FINDS_PER_DAY || 2),
  FREE_REVEALS_PER_DAY: Number(process.env.FREE_REVEALS_PER_DAY || 2),
  PRO_FINDS_PER_DAY: Number(process.env.PRO_FINDS_PER_DAY || 40),
  PRO_REVEALS_PER_DAY: Number(process.env.PRO_REVEALS_PER_DAY || 120),
  DEMO_TOTAL_STEPS: 1126,
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
  verified?: boolean;
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
const LEAD_POOL = new Map<string, Lead[]>();

/* Presence: simple heartbeat (last-seen timestamps) */
const PRESENCE = new Map<string, number>();
const PRESENCE_TTL_MS = 60_000;

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

/* Middleware to update presence on every request */
app.use((req, _res, next) => {
  const id = uidFromReq(req);
  PRESENCE.set(id, Date.now());
  next();
});

/* -------------------- Routes -------------------- */

app.get("/api/v1/healthz", (_req, res) => res.json({ ok: true }));

app.get("/presence/online", (_req, res) => {
  const now = Date.now();
  let total = 0;
  for (const [_, ts] of PRESENCE) if (now - ts < PRESENCE_TTL_MS) total++;
  res.json({ total });
});

/* Optional beat endpoint if you want to ping from the client */
app.post("/presence/beat", (req, res) => {
  const id = uidFromReq(req);
  PRESENCE.set(id, Date.now());
  res.json({ ok: true });
});

app.get("/api/v1/status", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const { findsLeft, revealsLeft } = countsLeft(u);
  res.json({
    ok: true,
    user: { id: u.id, plan: u.plan },
    quota: { findsLeft, revealsLeft, date: u.quota.date },
    gate: { email: u.email || null, domainMatch: !!u.verified },
    traits: u.traits,
  });
});

app.post("/api/v1/gate", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const { email, region } = req.body || {};
  if (email) u.email = String(email).trim();
  if (region && !u.traits.regions) {
    u.traits.regions = String(region)
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  }
  if (u.email && u.traits.vendorDomain) {
    const ed = emailDomain(u.email);
    const sd = bareHost(u.traits.vendorDomain);
    u.verified = !!(ed && sd && (ed === sd || ed.endsWith("." + sd)));
  }
  res.json({ ok: true, verified: !!u.verified });
});

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
  if (u.email && u.traits.vendorDomain) {
    const ed = emailDomain(u.email);
    const sd = bareHost(u.traits.vendorDomain);
    u.verified = !!(ed && sd && (ed === sd || ed.endsWith("." + sd)));
  }
  res.json({ ok: true, traits: u.traits, verified: !!u.verified });
});

app.post("/api/v1/find-now", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const { findsLeft } = countsLeft(u);

  if (findsLeft <= 0) {
    return res
      .status(200)
      .json({ ok: false, reason: "quota", findsLeft: 0, created: 0 });
  }

  u.quota.findsUsed += 1;
  ensureLeadPool(u);
  const created = Math.max(3, Math.floor(Math.random() * 6));
  return res.json({
    ok: true,
    created,
    findsLeft: countsLeft(u).findsLeft,
  });
});

app.get("/api/v1/leads", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  ensureLeadPool(u);
  const list = (LEAD_POOL.get(u.id) || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  res.json({ ok: true, leads: list });
});

app.post("/api/v1/events", (_req, res) => res.json({ ok: true }));
app.post("/api/v1/claim", (_req, res) => res.json({ ok: true, reservedForSec: 120 }));
app.post("/api/v1/own", (_req, res) => res.json({ ok: true }));

/* ---------- SSE: Signals Preview ---------- */
type Tick = {
  category: string;
  lane: "free" | "pro";
  chain: string[];
  done: number;
  total: number;
  locked?: boolean;
};

const PREVIEW: Array<Pick<Tick, "category" | "chain">> = [
  { category: "Demand", chain: ["Probe", "Filter", "Evidence", "Conclusion"] },
  { category: "Product", chain: ["Probe", "Filter", "Evidence", "Conclusion"] },
  { category: "Procurement", chain: ["Probe", "Filter", "Evidence", "Conclusion"] },
  { category: "Retail", chain: ["Probe", "Filter", "Evidence", "Conclusion"] },
  { category: "Wholesale", chain: ["Probe", "Filter", "Evidence", "Conclusion"] },
  { category: "Ops", chain: ["Probe", "Filter", "Evidence", "Conclusion"] },
  { category: "Events", chain: ["Probe", "Filter", "Evidence", "Conclusion"] },
  { category: "Reviews", chain: ["Probe", "Filter", "Evidence", "Conclusion"] },
  { category: "Timing", chain: ["Probe", "Filter", "Evidence", "Queue window"] },
];

app.get("/api/v1/progress.sse", (req: Request, res: Response) => {
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

  let catIdx = 0;
  const timer = setInterval(() => {
    const def = PREVIEW[catIdx % PREVIEW.length];
    catIdx++;

    freeDone = Math.min(total, freeDone + Math.floor(total * 0.012) + 1);
    send("tick", {
      category: def.category,
      lane: "free",
      chain: ["Probe", "Filter", "Evidence", "Conclusion"],
      done: freeDone,
      total,
    });

    const isPro = u.plan === "pro";
    proDone = Math.min(total, proDone + Math.floor(total * 0.018) + 2);
    send("tick", {
      category: def.category,
      lane: "pro",
      chain: ["Probe", "Filter", "Evidence", "Conclusion", "Auto-verify", "Queue window"],
      done: proDone,
      total,
      locked: !isPro,
    });

    if (freeDone >= Math.min(80, Math.floor(total * 0.07))) {
      send("halt", { freeDone, total, checkout: "/checkout/stripe?plan=pro" });
      clearInterval(timer);
      send("done", { ok: true });
    }
  }, 1200);

  req.on("close", () => clearInterval(timer));
});

/* -------------------- Start -------------------- */
app.listen(ENV.PORT, () => {
  console.log(`API listening on :${ENV.PORT}`);
});
