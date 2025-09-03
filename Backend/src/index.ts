/**
 * Galactly API — index.ts
 * - presence/online
 * - /api/v1/status
 * - /api/v1/gate
 * - /api/v1/vault
 * - /api/v1/find-now
 * - /api/v1/progress.sse   (Server-Sent Events)
 * - (DEBUG) /api/v1/debug/reset
 *
 * Dev unlimited toggle: send header `x-galactly-dev: unlim` (DEBUG=1 must be set).
 */

import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import crypto from "crypto";

const PORT = Number(process.env.PORT || 8787);
const DEBUG = process.env.DEBUG === "1";

// --------- Types ----------
type Plan = "free" | "pro";

type Quota = {
  findsLimit: number;
  revealsLimit: number;
  findsUsed: number;
  revealsUsed: number;
  nextResetAt: number; // epoch ms (daily)
};

type Gate = {
  email?: string;
  emailDomain?: string;
  region?: string;
  domainMatch?: boolean;
};

type Traits = {
  vendorDomain?: string | null;
  regions?: string[];
  industries?: string[];
  buyers?: string[];
  notes?: string | null;
};

type Counts = {
  freeDone: number;
  proDone: number;
};

type User = {
  id: string;
  plan: Plan;
  createdAt: number;
  updatedAt: number;
  quota: Quota;
  gate: Gate;
  traits: Traits;
  counts: Counts;
};

// --------- App ----------
const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// --------- Presence (simple last-seen store) ----------
const online = new Map<string, number>(); // id -> lastSeen
const ONLINE_WINDOW_MS = 30_000;

function countOnline(): number {
  const now = Date.now();
  let n = 0;
  for (const [k, t] of online) {
    if (now - t < ONLINE_WINDOW_MS) n++;
  }
  return n;
}

// --------- In-memory DB ----------
const USERS = new Map<string, User>();

// defaults
const FREE_LIMIT = { finds: 2, reveals: 2 };
const PRO_LIMIT = { finds: 200, reveals: 200 };

// --------- Helpers ----------
function uidFromReq(req: Request): string {
  // stable-ish uid per browser: header x-galactly-user; else set a cookie-like fallback id
  const h = (req.header("x-galactly-user") || "").trim();
  if (h) return h;
  // fallback: hash ip+ua (do not rely for production auth)
  const raw = `${req.ip}|${req.header("user-agent") || ""}`;
  return "anon_" + crypto.createHash("sha1").update(raw).digest("hex").slice(0, 24);
}

function startOfTomorrow(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() + 24 * 3600 * 1000;
}

function defaultQuota(plan: Plan): Quota {
  const lim = plan === "pro" ? PRO_LIMIT : FREE_LIMIT;
  return {
    findsLimit: lim.finds,
    revealsLimit: lim.reveals,
    findsUsed: 0,
    revealsUsed: 0,
    nextResetAt: startOfTomorrow(),
  };
}

function getOrInitUser(id: string): User {
  let u = USERS.get(id);
  if (!u) {
    u = {
      id,
      plan: "free",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      quota: defaultQuota("free"),
      gate: {},
      traits: {},
      counts: { freeDone: 0, proDone: 0 },
    };
    USERS.set(id, u);
  }
  // daily reset
  if (Date.now() >= u.quota.nextResetAt) {
    const plan = u.plan;
    u.quota = defaultQuota(plan);
  }
  return u;
}

function emailDomain(email?: string): string | undefined {
  const m = String(email || "").toLowerCase().match(/^[^@]+@([^@]+)$/);
  if (!m) return undefined;
  return m[1].replace(/^www\./, "");
}

function domainsMatch(emailDom?: string, siteDom?: string): boolean {
  if (!emailDom || !siteDom) return false;
  if (emailDom === siteDom) return true;
  return emailDom.endsWith("." + siteDom);
}

function countsLeft(u: User, devUnlim: boolean) {
  const limF = u.quota.findsLimit;
  const limR = u.quota.revealsLimit;
  const findsLeft = devUnlim ? 9999 : Math.max(0, limF - u.quota.findsUsed);
  const revealsLeft = devUnlim ? 9999 : Math.max(0, limR - u.quota.revealsUsed);
  return { findsLeft, revealsLeft };
}

// dev unlimited condition (only when DEBUG=1)
function isDevUnlimited(req: Request, u: User): boolean {
  if (!DEBUG) return false;
  const hdr = (req.header("x-galactly-dev") || "").trim();
  return hdr.toLowerCase() === "unlim";
}

// touch presence + user updatedAt
app.use((req, _res, next) => {
  const id = uidFromReq(req);
  online.set(id, Date.now());
  const u = getOrInitUser(id);
  u.updatedAt = Date.now();
  next();
});

// --------- Routes ----------

// Presence
app.get("/presence/online", (req, res) => {
  res.json({ total: countOnline() });
});

// Status: quota + gate summary
app.get("/api/v1/status", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const devUnlim = isDevUnlimited(req, u);
  // if dev unlimited, emulate pro limits
  const q = countsLeft(u, devUnlim);

  const ed = u.gate.emailDomain;
  const vd = u.traits.vendorDomain || undefined;
  const match = domainsMatch(ed, vd);

  res.json({
    ok: true,
    plan: u.plan,
    quota: {
      findsLeft: q.findsLeft,
      revealsLeft: q.revealsLeft,
      nextResetAt: u.quota.nextResetAt,
    },
    gate: {
      email: u.gate.email || null,
      emailDomain: ed || null,
      domainMatch: !!match,
    },
    counts: u.counts,
  });
});

// Gate: email & region (website not needed here)
app.post("/api/v1/gate", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const email = String(req.body?.email || "").trim();
  const region = String(req.body?.region || "").trim();
  if (email) {
    u.gate.email = email;
    u.gate.emailDomain = emailDomain(email);
  }
  if (region) u.gate.region = region;
  res.json({ ok: true });
});

// Vault: traits
app.post("/api/v1/vault", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);

  const t = (req.body?.traits || {}) as Traits;
  u.traits.vendorDomain = (t.vendorDomain || "").trim() || null;
  u.traits.regions = Array.isArray(t.regions) ? t.regions : [];
  u.traits.industries = Array.isArray(t.industries) ? t.industries : [];
  u.traits.buyers = Array.isArray(t.buyers) ? t.buyers : [];
  u.traits.notes = t.notes || null;

  // compute domain match flag for info
  const match = domainsMatch(u.gate.emailDomain, u.traits.vendorDomain || undefined);
  u.gate.domainMatch = !!match;

  res.json({ ok: true, traits: u.traits, gate: u.gate });
});

// Find now: consume one search unless dev unlimited
app.post("/api/v1/find-now", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const devUnlim = isDevUnlimited(req, u);

  if (!devUnlim) {
    const { findsLeft } = countsLeft(u, false);
    if (findsLeft <= 0) {
      return res.status(200).json({ ok: false, reason: "quota" });
    }
    u.quota.findsUsed++;
  }

  // rough synthetic “created count”
  const created = 3 + Math.floor(Math.random() * 3);
  res.json({ ok: true, created });
});

// SSE preview stream
app.get("/api/v1/progress.sse", (req, res) => {
  const id = uidFromReq(req);
  const u = getOrInitUser(id);
  const devUnlim = isDevUnlimited(req, u);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  // helper
  function send(ev: string, data: any) {
    res.write(`event: ${ev}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Emit 8–12 ticks. Free lane halts early; Pro lane continues if pro/unlim.
  const start = Date.now();
  let i = 0;

  // basic chain words
  const chains = [
    ["probing demand", "scanning procurement", "reading reviews", "classifying", "platform map"],
    ["price/qty deltas", "brand→SKU graph", "ERP hints", "region filters"],
    ["dedup & score", "compose outreach"]
  ];

  const timer = setInterval(() => {
    i++;
    const lane = (u.plan === "pro" || devUnlim) ? (i % 2 ? "pro" : "free") : "free";
    const category = lane === "free" ? "Demand" : "Demand+Product";
    const chain = chains[Math.floor(Math.random() * chains.length)];

    // update done counters
    if (lane === "free") u.counts.freeDone++;
    else u.counts.proDone++;

    send("tick", {
      lane,
      category,
      done: lane === "free" ? u.counts.freeDone : u.counts.proDone,
      total: lane === "free" ? 6 : 12,
      locked: lane === "pro" && u.plan === "free" && !devUnlim,
      chain
    });

    // halt/finish rules
    const hitFreeCap = u.counts.freeDone >= 6;
    const hitProCap = u.counts.proDone >= 12;

    if (!devUnlim && u.plan === "free" && hitFreeCap) {
      send("halt", { reason: "free_cap" });
      clearInterval(timer);
      res.end();
    } else if ((u.plan === "pro" || devUnlim) && hitProCap) {
      send("done", { ms: Date.now() - start });
      clearInterval(timer);
      res.end();
    }

  }, 600); // slow & readable

  // client disconnect
  req.on("close", () => clearInterval(timer));
});

// --------- DEBUG tools ----------
if (DEBUG) {
  app.post("/api/v1/debug/reset", (req, res) => {
    const id = uidFromReq(req);
    const u = getOrInitUser(id);
    u.quota.findsUsed = 0;
    u.quota.revealsUsed = 0;
    u.counts.freeDone = 0;
    u.counts.proDone = 0;
    return res.json({ ok: true, quota: countsLeft(u, false) });
  });
}

// --------- Start ----------
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
