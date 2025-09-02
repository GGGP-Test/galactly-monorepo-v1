// backend/src/Index.ts
// Galactly API — plan gating, quotas, presence, vault (profile/saved/owned),
// streaming preview mount. Free users must SIGN UP to access the vault.
// Zero-cost friendly (in-memory) until you swap to Neon.

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import http from "http";
import path from "path";
import crypto from "crypto";

import progressRouter from "./routes/progress";

// ---------- Config ----------
const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || "development";

const FREE_FINDS_PER_DAY = Number(process.env.FREE_FINDS_PER_DAY || 2);
const FREE_REVEALS_PER_DAY = Number(process.env.FREE_REVEALS_PER_DAY || 2);

const PRO_FINDS_PER_DAY = Number(process.env.PRO_FINDS_PER_DAY || 40);
const PRO_REVEALS_PER_DAY = Number(process.env.PRO_REVEALS_PER_DAY || 200);

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ""; // optional in dev

// ---------- Types / In-memory state ----------
type Plan = "free" | "pro";
type Quota = { date: string; findsUsed: number; revealsUsed: number };

type Lead = {
  id: string;
  title: string;
  tags: string[];
  confidence?: number;     // 0..1
  createdAt: number;
};

type Traits = {
  vendorDomain?: string;
  industries?: string[];
  regions?: string[];
  buyers?: string[];
  notes?: string | null;
};

type Prefs = {
  theme?: "dark" | "light";
  alerts?: { email?: boolean; sms?: boolean };
  muteDomains?: string[];
};

type User = {
  id: string;                  // x-galactly-user
  plan: Plan;
  role?: "supplier" | "distributor" | "buyer";
  email?: string;              // set on signup/onboarding
  company?: string;
  region?: string;
  createdAt: number;
  quota: Quota;
  traits: Traits;
  prefs: Prefs;
  confirmedProofs: Array<{ at: number; host: string }>;
  savedLeads: Map<string, Lead>;
  ownedLeads: Map<string, Lead>;
};

const USERS = new Map<string, User>();

// presence (soft)
const PRESENCE = new Map<string, number>(); // userId -> lastBeatMs

// demo lead pool (rotated)
const DEMO_LEADS: Lead[] = [
  { id: "L1", tags: ["demand", "Confidence 80% (strong)"], title: "•l••••••,••• — •• ••••pa••••• s••••", createdAt: Date.now() },
  { id: "L2", tags: ["demand", "Confidence 70% (solid)"],   title: "g•••••,c• — •• ••••s••nc• •••••", createdAt: Date.now() },
  { id: "L3", tags: ["procurement", "Confidence 65%"],       title: "••••••• ••— •••••• — •• ••••", createdAt: Date.now() },
];

// ---------- Helpers ----------
const UTCday = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const isOnboarded = (u: User) => Boolean(u.email); // minimal: email indicates signup

function ensureUser(id: string): User {
  let u = USERS.get(id);
  if (!u) {
    u = {
      id,
      plan: "free",
      createdAt: Date.now(),
      quota: { date: UTCday(), findsUsed: 0, revealsUsed: 0 },
      traits: {},
      prefs: { theme: "dark", alerts: { email: true, sms: false }, muteDomains: [] },
      confirmedProofs: [],
      savedLeads: new Map(),
      ownedLeads: new Map(),
    };
    USERS.set(id, u);
  }
  // reset quotas at UTC midnight
  const today = UTCday();
  if (u.quota.date !== today) {
    u.quota = { date: today, findsUsed: 0, revealsUsed: 0 };
  }
  if (!u.prefs.muteDomains) u.prefs.muteDomains = [];
  return u;
}

declare global {
  namespace Express { interface Request { user?: User } }
}

// attach user to request for /api and /presence
function withUser(req: Request, _res: Response, next: NextFunction) {
  const uid = String(req.header("x-galactly-user") || "").trim();
  if (!uid) {
    const temp = "anon_" + crypto.randomBytes(6).toString("hex");
    req.user = ensureUser(temp);
  } else {
    req.user = ensureUser(uid);
  }
  // optional dev override
  const planOverride = req.header("x-galactly-plan");
  if (planOverride === "free" || planOverride === "pro") req.user!.plan = planOverride;
  next();
}

function requireOnboarded(req: Request, res: Response, next: NextFunction) {
  const u = req.user!;
  if (!isOnboarded(u)) return res.status(401).json({ ok: false, error: "needs_onboarding" });
  next();
}

function requirePro(req: Request, res: Response, next: NextFunction) {
  const u = req.user!;
  if (u.plan !== "pro") return res.status(402).json({ ok: false, error: "pro_required" });
  next();
}

// ---------- Express ----------
const app = express();
app.disable("x-powered-by");
app.use(cors());

// IMPORTANT: Stripe webhook FIRST (raw body), before express.json()
app.post("/api/v1/stripe/webhook", express.raw({ type: "*/*" }), (req: Request, res: Response) => {
  try {
    let event: any;

    if (STRIPE_WEBHOOK_SECRET) {
      const sig = req.header("stripe-signature");
      if (!sig) return res.status(400).send("Missing signature");
      const payload = req.body as Buffer;
      // Soft dev check; for prod use Stripe SDK verify
      const computed = crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(payload).digest("hex");
      if (!String(sig).includes(computed.slice(0, 16))) {
        console.warn("Webhook HMAC prefix mismatch (dev-mode soft check).");
      }
      event = JSON.parse(payload.toString("utf8"));
    } else {
      // Dev: accept JSON body
      event = JSON.parse((req.body as Buffer).toString("utf8"));
    }

    if (event?.type === "checkout.session.completed") {
      const uid = event?.data?.object?.metadata?.galactly_user;
      if (uid && USERS.has(uid)) {
        const u = USERS.get(uid)!;
        u.plan = "pro";
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

// Now parse JSON for the rest
app.use(express.json());

// Attach user on /api and /presence
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/presence/")) withUser(req, res, next);
  else next();
});

// ---------- Status & Basic Profile ----------
app.get("/api/v1/status", (req, res) => {
  const u = req.user!;
  const limits = u.plan === "pro"
    ? { findsPerDay: PRO_FINDS_PER_DAY, revealsPerDay: PRO_REVEALS_PER_DAY }
    : { findsPerDay: FREE_FINDS_PER_DAY, revealsPerDay: FREE_REVEALS_PER_DAY };

  res.json({
    ok: true,
    engine: "ready",
    user: { id: u.id, plan: u.plan, role: u.role || null, email: u.email || null, company: u.company || null },
    onboarded: isOnboarded(u),
    quota: {
      findsLeft: Math.max(0, limits.findsPerDay - u.quota.findsUsed),
      revealsLeft: Math.max(0, limits.revealsPerDay - u.quota.revealsUsed),
      date: u.quota.date,
    },
  });
});

app.get("/api/v1/user", (req, res) => {
  const u = req.user!;
  res.json({
    ok: true,
    user: {
      id: u.id, plan: u.plan, role: u.role || null,
      email: u.email || null, company: u.company || null, region: u.region || null,
      traits: u.traits, prefs: u.prefs, createdAt: u.createdAt
    }
  });
});

// Upsert gate from onboarding — this is the "signup" that unlocks the Vault
app.post("/api/v1/gate", (req, res) => {
  const u = req.user!;
  const { email, region, role, company } = req.body || {};
  if (role && ["supplier", "distributor", "buyer"].includes(role)) u.role = role;
  if (typeof email === "string") u.email = email;
  if (typeof company === "string") u.company = company;
  if (typeof region === "string") u.region = region;
  res.json({ ok: true, onboarded: isOnboarded(u), user: { id: u.id, plan: u.plan, role: u.role || null } });
});

// ---------- Vault (profile, prefs, saved/owned) — requires signup ----------
app.get("/api/v1/vault", requireOnboarded, (req, res) => {
  const u = req.user!;
  res.json({
    ok: true,
    plan: u.plan,
    quota: u.quota,
    traits: u.traits,
    prefs: u.prefs,
    counts: {
      saved: u.savedLeads.size,
      owned: u.ownedLeads.size,
      confirmedProofs: u.confirmedProofs.length
    }
  });
});

app.post("/api/v1/vault", requireOnboarded, (req, res) => {
  const u = req.user!;
  const { role, traits, prefs } = req.body || {};
  if (role && ["supplier", "distributor", "buyer"].includes(role)) u.role = role;

  if (traits && typeof traits === "object") {
    const t: Traits = {
      vendorDomain: typeof traits.vendorDomain === "string" ? traits.vendorDomain : u.traits.vendorDomain,
      industries: Array.isArray(traits.industries) ? traits.industries : u.traits.industries,
      regions: Array.isArray(traits.regions) ? traits.regions : u.traits.regions,
      buyers: Array.isArray(traits.buyers) ? traits.buyers : u.traits.buyers,
      notes: typeof traits.notes === "string" || traits.notes === null ? traits.notes : u.traits.notes,
    };
    u.traits = t;
  }
  if (prefs && typeof prefs === "object") {
    u.prefs.theme = prefs.theme === "light" ? "light" : "dark";
    if (prefs.alerts) {
      u.prefs.alerts = {
        email: typeof prefs.alerts.email === "boolean" ? prefs.alerts.email : (u.prefs.alerts?.email ?? true),
        sms: typeof prefs.alerts.sms === "boolean" ? prefs.alerts.sms : (u.prefs.alerts?.sms ?? false),
      };
    }
    if (Array.isArray(prefs.muteDomains)) {
      u.prefs.muteDomains = prefs.muteDomains.filter((x: any) => typeof x === "string");
    }
  }
  res.json({ ok: true, traits: u.traits, prefs: u.prefs });
});

// Vault leads
app.get("/api/v1/vault/leads", requireOnboarded, (req, res) => {
  const u = req.user!;
  const kind = String(req.query.kind || "saved"); // saved | owned
  const src = kind === "owned" ? u.ownedLeads : u.savedLeads;
  res.json({ ok: true, kind, leads: Array.from(src.values()).sort((a,b)=>b.createdAt-a.createdAt) });
});

app.post("/api/v1/vault/save", requireOnboarded, (req, res) => {
  const u = req.user!;
  const lead = req.body?.lead as Partial<Lead>;
  if (!lead?.id || !lead?.title) return res.status(400).json({ ok: false, error: "invalid_lead" });
  const L: Lead = {
    id: String(lead.id),
    title: String(lead.title),
    tags: Array.isArray(lead.tags) ? lead.tags.map(String) : [],
    confidence: typeof lead.confidence === "number" ? lead.confidence : undefined,
    createdAt: Date.now(),
  };
  u.savedLeads.set(L.id, L);
  res.json({ ok: true });
});

app.post("/api/v1/vault/remove", requireOnboarded, (req, res) => {
  const u = req.user!;
  const { leadId } = req.body || {};
  if (!leadId) return res.status(400).json({ ok: false, error: "missing_leadId" });
  u.savedLeads.delete(String(leadId));
  res.json({ ok: true });
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

  const created = Math.floor(1 + Math.random() * 3);
  res.json({ ok: true, created });
});

app.get("/api/v1/leads", (req, res) => {
  const u = req.user!;
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
    if (!u.prefs.muteDomains) u.prefs.muteDomains = [];
    if (!u.prefs.muteDomains.includes(host)) u.prefs.muteDomains.push(host);
  }
  res.json({ ok: true });
});

// claim/own — PRO ONLY (exclusive window)
const CLAIMS = new Map<string, { by: string; at: number }>(); // leadId -> claim
app.post("/api/v1/claim", requireOnboarded, requirePro, (req, res) => {
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

app.post("/api/v1/own", requireOnboarded, requirePro, (req, res) => {
  const u = req.user!;
  const { leadId, title, tags } = req.body || {};
  if (!leadId) return res.status(400).json({ ok: false, error: "missing_leadId" });

  const existing = CLAIMS.get(leadId);
  if (!existing || existing.by !== u.id) {
    return res.status(409).json({ ok: false, error: "not_claimed_by_you" });
  }
  CLAIMS.delete(leadId);

  const L: Lead = { id: String(leadId), title: String(title || "Owned lead"), tags: Array.isArray(tags)? tags.map(String):[], createdAt: Date.now() };
  u.ownedLeads.set(L.id, L);
  u.savedLeads.delete(L.id);

  res.json({ ok: true, owned: true });
});

// ---------- Metrics snapshot (for Vault graphs) — requires signup ----------
app.get("/api/v1/metrics/summary", requireOnboarded, (req, res) => {
  const u = req.user!;
  const days = Number(req.query.days || 7);
  const points = Math.max(7, Math.min(30, days));
  const rand = (n:number, base:number) => Math.max(0, Math.round(base + (Math.random()*n - n/2)));

  const spark = Array.from({length: points}, () => ({
    seen: rand(12, 18),
    reveals: rand(4, 6),
    saved: rand(3, 5),
    owned: rand(1, 2),
    confirms: rand(1, 2),
  }));

  const totals = spark.reduce((a,c)=>({
    seen:a.seen+c.seen, reveals:a.reveals+c.reveals, saved:a.saved+c.saved, owned:a.owned+c.owned, confirms:a.confirms+c.confirms
  }), { seen:0,reveals:0,saved:0,owned:0,confirms:0 });

  res.json({ ok:true, period:`${points}d`, totals, spark });
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

// Dev helper: flip plan without Stripe
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

// ---------- Utilities ----------
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
