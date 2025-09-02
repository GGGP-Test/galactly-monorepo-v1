// backend/src/Index.ts
// Galactly API bootstrap — plan gating, quotas, presence, stubs.
// Zero-cost friendly: everything runs in-memory until you switch to Neon.

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import http from "http";
import path from "path";
import crypto from "crypto";

import progressRouter from "./routes/progress";

// ---------- Config (env or sensible defaults) ----------
const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || "development";

const FREE_FINDS_PER_DAY = Number(process.env.FREE_FINDS_PER_DAY || 2);
const FREE_REVEALS_PER_DAY = Number(process.env.FREE_REVEALS_PER_DAY || 2);

const PRO_FINDS_PER_DAY = Number(process.env.PRO_FINDS_PER_DAY || 40);
const PRO_REVEALS_PER_DAY = Number(process.env.PRO_REVEALS_PER_DAY || 200);

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ""; // optional during dev

// ---------- In-memory data (swap to Neon later) ----------
type Plan = "free" | "pro";
type Quota = { date: string; findsUsed: number; revealsUsed: number };
type User = {
  id: string;            // x-galactly-user
  plan: Plan;
  role?: "supplier" | "distributor" | "buyer";
  email?: string;
  company?: string;
  region?: string;
  createdAt: number;
  quota: Quota;
  confirmedProofs: Array<{ at: number; host: string }>;
  muteDomains: Set<string>;
};

const USERS = new Map<string, User>();

// presence (soft)
const PRESENCE = new Map<string, number>(); // userId -> lastBeatMs

// demo lead pool (rotated)
const DEMO_LEADS = [
  { id: "L1", tags: ["demand", "Confidence 80% (strong)"], title: "•l••••••,••• — •• ••••pa••••• s••••" },
  { id: "L2", tags: ["demand", "Confidence 70% (solid)"],   title: "g•••••,c• — •• ••••s••nc• •••••" },
  { id: "L3", tags: ["procurement", "Confidence 65%"],       title: "••••••• ••— •••••• — •• ••••" },
];

// ---------- Helpers ----------
const UTCday = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function ensureUser(id: string): User {
  let u = USERS.get(id);
  if (!u) {
    u = {
      id,
      plan: "free",
      createdAt: Date.now(),
      quota: { date: UTCday(), findsUsed: 0, revealsUsed: 0 },
      confirmedProofs: [],
      muteDomains: new Set(),
    };
    USERS.set(id, u);
  }
  // reset quotas at UTC midnight
  const today = UTCday();
  if (u.quota.date !== today) {
    u.quota = { date: today, findsUsed: 0, revealsUsed: 0 };
  }
  return u;
}

declare global {
  // augment Request for TS
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

function withUser(req: Request, _res: Response, next: NextFunction) {
  const uid = String(req.header("x-galactly-user") || "").trim();
  if (!uid) {
    // anonymous still gets an ephemeral user
    const temp = "anon_" + crypto.randomBytes(6).toString("hex");
    req.user = ensureUser(temp);
  } else {
    req.user = ensureUser(uid);
  }
  // Optional dev override: x-galactly-plan
  const planOverride = req.header("x-galactly-plan");
  if (planOverride === "free" || planOverride === "pro") {
    req.user!.plan = planOverride;
  }
  next();
}

// ---------- Express ----------
const app = express();
app.disable("x-powered-by");

// Allow JSON for normal routes;
// Stripe webhook (raw body) is handled on that route specifically.
app.use(cors());
app.use(express.json());

// Attach user to every /api and /presence route
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/presence/")) withUser(req, res, next);
  else next();
});

// ---------- Status & Gating ----------
app.get("/api/v1/status", (req, res) => {
  const u = req.user!;
  const limits = u.plan === "pro"
    ? { findsPerDay: PRO_FINDS_PER_DAY, revealsPerDay: PRO_REVEALS_PER_DAY }
    : { findsPerDay: FREE_FINDS_PER_DAY, revealsPerDay: FREE_REVEALS_PER_DAY };

  res.json({
    ok: true,
    engine: "ready",
    user: { id: u.id, plan: u.plan, role: u.role || null },
    quota: {
      findsLeft: Math.max(0, limits.findsPerDay - u.quota.findsUsed),
      revealsLeft: Math.max(0, limits.revealsPerDay - u.quota.revealsUsed),
      date: u.quota.date,
    },
  });
});

// Upsert gate (email/domain/region). Light validation only.
app.post("/api/v1/gate", (req, res) => {
  const u = req.user!;
  const { email, region, role, company } = req.body || {};
  if (role && ["supplier", "distributor", "buyer"].includes(role)) u.role = role;
  if (typeof email === "string") u.email = email;
  if (typeof company === "string") u.company = company;
  if (typeof region === "string") u.region = region;
  res.json({ ok: true, user: { id: u.id, plan: u.plan, role: u.role || null } });
});

// ---------- Leads / Find-now (stubs; no paid calls) ----------
app.post("/api/v1/find-now", (req, res) => {
  const u = req.user!;
  const limits = u.plan === "pro"
    ? { findsPerDay: PRO_FINDS_PER_DAY }
    : { findsPerDay: FREE_FINDS_PER_DAY };

  if (u.quota.findsUsed >= limits.findsPerDay) {
    return res.status(429).json({ ok: false, error: "quota_exceeded" });
  }
  u.quota.findsUsed += 1;

  // Seed the lead pool "server side"; the UI will poll /leads and trickle.
  const created = Math.floor(1 + Math.random() * 3);
  res.json({ ok: true, created });
});

app.get("/api/v1/leads", (req, res) => {
  const u = req.user!;
  // Rotate a few demo leads; platform rotation is server-side in real impl.
  const out = DEMO_LEADS.slice(0, 2 + (u.plan === "pro" ? 1 : 0));
  res.json({ ok: true, leads: out });
});

// confirm/mute/etc. (kept per-user; no global heat bump)
app.post("/api/v1/events", (req, res) => {
  const u = req.user!;
  const { type, host } = req.body || {};
  if (type === "confirm" && typeof host === "string") {
    u.confirmedProofs.push({ at: Date.now(), host });
  }
  if (type === "mute" && typeof host === "string") {
    u.muteDomains.add(host);
  }
  res.json({ ok: true });
});

// claim/own (2-min window simulated)
const CLAIMS = new Map<string, { by: string; at: number }>(); // leadId -> claim
app.post("/api/v1/claim", (req, res) => {
  const u = req.user!;
  const { leadId } = req.body || {};
  if (!leadId) return res.status(400).json({ ok: false, error: "missing_leadId" });

  const now = Date.now();
  const existing = CLAIMS.get(leadId);
  if (existing && now - existing.at < 120_000 && existing.by !== u.id) {
    return res.status(409).json({ ok: false, error: "already_claimed" });
  }
  CLAIMS.set(leadId, { by: u.id, at: now });
  res.json({ ok: true, reservedForSec: 120 });
});

app.post("/api/v1/own", (req, res) => {
  const u = req.user!;
  const { leadId } = req.body || {};
  if (!leadId) return res.status(400).json({ ok: false, error: "missing_leadId" });

  const existing = CLAIMS.get(leadId);
  if (!existing || existing.by !== u.id) {
    return res.status(409).json({ ok: false, error: "not_claimed_by_you" });
  }
  CLAIMS.delete(leadId);
  // In real impl: persist ownership to DB.
  res.json({ ok: true, owned: true });
});

// ---------- Presence ----------
app.post("/presence/beat", (req, res) => {
  const u = req.user!;
  PRESENCE.set(u.id, Date.now());
  res.json({ ok: true });
});
app.get("/presence/online", (_req, res) => {
  const now = Date.now();
  let total = 0;
  for (const [, at] of PRESENCE) if (now - at < 60_000) total++;
  res.json({ ok: true, total });
});

// ---------- Streaming preview (SSE) ----------
app.use("/api/v1", progressRouter); // /api/v1/progress.sse
// The router reads req.user.plan for Free vs Pro behavior.

// ---------- Stripe (optional during dev) ----------
// Create Checkout sessions on the frontend using Stripe.js if you like.
// Webhook below flips plan instantly when payment succeeds.
app.post("/api/v1/stripe/webhook", express.raw({ type: "*/*" }), (req: Request, res: Response) => {
  try {
    let event: any;

    if (STRIPE_WEBHOOK_SECRET) {
      // Verify signature
      const sig = req.header("stripe-signature");
      if (!sig) return res.status(400).send("Missing signature");
      const payload = req.body as Buffer;
      const header = String(sig);
      // Minimal verifier for dev: HMAC check (for real use, use stripe SDK)
      const computed = crypto
        .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");
      if (!header.includes(computed.slice(0, 16))) {
        // Not a full verification—use official Stripe library in prod.
        console.warn("Webhook HMAC prefix mismatch (dev mode).");
      }
      event = JSON.parse(payload.toString("utf8"));
    } else {
      // Dev-friendly: accept JSON and flip plan if id present
      event = JSON.parse((req.body as Buffer).toString("utf8"));
    }

    // Handle only 'checkout.session.completed' (dev)
    if (event?.type === "checkout.session.completed") {
      const uid = event?.data?.object?.metadata?.galactly_user;
      if (uid && USERS.has(uid)) {
        const u = USERS.get(uid)!;
        u.plan = "pro";
        // bump quotas immediately
        u.quota = { date: UTCday(), findsUsed: 0, revealsUsed: 0 };
        console.log(`User ${uid} upgraded to PRO via Stripe webhook.`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(400).send("Webhook error");
  }
});

// Dev helper: flip plan without Stripe (disabled in prod)
if (NODE_ENV !== "production") {
  app.post("/api/v1/admin/flip-plan", (req, res) => {
    const u = req.user!;
    const { plan } = req.body || {};
    if (plan === "free" || plan === "pro") {
      u.plan = plan;
      u.quota = { date: UTCday(), findsUsed: 0, revealsUsed: 0 };
      return res.json({ ok: true, plan: u.plan });
    }
    res.status(400).json({ ok: false, error: "invalid_plan" });
  });
}

// ---------- Misc ----------
app.get("/__routes", (_req, res) => {
  const routes: string[] = [];
  app._router.stack.forEach((m: any) => {
    if (m.route && m.route.path) {
      const methods = Object.keys(m.route.methods).join(",").toUpperCase();
      routes.push(`${methods} ${m.route.path}`);
    } else if (m.name === "router" && m.handle?.stack) {
      m.handle.stack.forEach((h: any) => {
        if (h.route) {
          const methods = Object.keys(h.route.methods).join(",").toUpperCase();
          routes.push(`${methods} ${h.route.path}`);
        }
      });
    }
  });
  res.type("text/plain").send(routes.sort().join("\n"));
});

// Static hosting for quick local preview (optional)
app.use("/", express.static(path.join(process.cwd(), "frontend")));

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Galactly API listening on :${PORT} [${NODE_ENV}]`);
});
