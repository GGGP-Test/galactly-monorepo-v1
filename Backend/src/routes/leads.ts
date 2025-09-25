import { Router, Request, Response } from "express";

// NOTE: DB is optional at runtime. If your Neon pool is available under
// src/shared/db.ts exporting `pool`, we'll use it. If not, we still 200.
let pool: any = null;
try {
  // keep the single canonical path you've standardized already
  // (do not change this without agreeing on a new single path)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  pool = require("../shared/db").pool;
} catch {
  /* DB optional */
}

const router = Router();

// ------------------------------
// Tiny in-memory store (TTL) so locks survive short sessions even if DB write fails
type Lead = {
  host: string;
  platform?: string;
  title: string;
  created: string;
  temp: "warm" | "hot";
  why?: string;
  supplier_host?: string;
};
const lockedMem = new Map<string, { lead: Lead; at: number }>();
const TTL_MS = 60 * 60 * 1000;

// housekeeping
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of lockedMem) if (now - v.at > TTL_MS) lockedMem.delete(k);
}, 10 * 60 * 1000);

// ------------------------------
// Tier rules (inline to keep to one file). Extend these as needed.
// Each entry is a buyer host with one or more supplier/procurement pages to show.
type Buyer = { host: string; pages: { path: string; title: string }[]; tier: "A" | "B"; vertical: "CPG" | "Retail" | "Food" | "Household" };
const BUYERS: Buyer[] = [
  { host: "clorox.com",         tier: "A", vertical: "Household", pages: [{ path: "/suppliers", title: "Suppliers & procurement | Clorox" }] },
  { host: "hormelfoods.com",    tier: "A", vertical: "Food",      pages: [{ path: "/supplier", title: "Supplier / vendor info | Hormel Foods" }] },
  { host: "generalmills.com",   tier: "A", vertical: "Food",      pages: [{ path: "/suppliers", title: "Suppliers | General Mills" }] },
  { host: "kraftheinzcompany.com", tier: "A", vertical: "Food",   pages: [{ path: "/procurement", title: "Procurement | Kraft Heinz" }] },
  { host: "pepsico.com",        tier: "A", vertical: "CPG",       pages: [{ path: "/suppliers", title: "Supplier portal | PepsiCo" }] },
  { host: "mondelezinternational.com", tier: "A", vertical: "Food", pages: [{ path: "/suppliers", title: "Suppliers | Mondelēz International" }] },
  { host: "nestle.com",         tier: "A", vertical: "Food",      pages: [{ path: "/suppliers", title: "Suppliers | Nestlé" }] },
  { host: "pandg.com",          tier: "A", vertical: "Household", pages: [{ path: "/suppliers", title: "Suppliers | P&G" }] },
  { host: "johnsonandjohnson.com", tier: "A", vertical: "CPG",    pages: [{ path: "/business/partner-with-us", title: "Partner with us | J&J" }] },
  // Tier B examples
  { host: "churchdwight.com",   tier: "B", vertical: "Household", pages: [{ path: "/suppliers", title: "Suppliers | Church & Dwight" }] },
  { host: "campbellsoupcompany.com", tier: "B", vertical: "Food", pages: [{ path: "/suppliers", title: "Suppliers | Campbell Soup Company" }] },
  { host: "postholdings.com",   tier: "B", vertical: "Food",      pages: [{ path: "/suppliers", title: "Suppliers | Post Holdings" }] },
];

// helper: normalize a host without regex
function normHost(input: string): string {
  let s = (input || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    let h = (u.hostname || "").toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    let h = (input || "").trim().toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  }
}

// pick a Tier A/B buyer not equal to supplier
function pickBuyer(supplierHost: string): { host: string; title: string; why: string } | null {
  const sup = normHost(supplierHost);
  // crude vertical guess: if supplier name contains "pack" prefer Food/CPG Tier A
  const prefer = /pack|carton|box|label|film|flex/i.test(supplierHost) ? ["Food", "CPG"] : ["CPG", "Retail", "Food", "Household"];

  const pool: Buyer[] = BUYERS
    .filter(b => b.host !== sup && prefer.includes(b.vertical))
    // prefer Tier A first
    .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "A" ? -1 : 1));

  if (pool.length === 0) return null;

  // simple rotation
  const chosen = pool[Math.floor(Math.random() * Math.min(pool.length, 6))];
  const page = chosen.pages[0];
  const why = `Tier ${chosen.tier} ${chosen.vertical}; supplier program (picked for supplier: ${sup})`;
  return { host: chosen.host, title: page.title, why };
}

// GET /api/leads/find-buyers?host=SUPPLIER&region=US/CA&radius=50+mi
router.get("/leads/find-buyers", async (req: Request, res: Response) => {
  const supplier = String(req.query.host || "").trim();
  if (!supplier) return res.status(400).json({ error: "host is required" });

  const picked = pickBuyer(supplier);
  if (!picked) return res.status(404).json({ error: "no match" });

  // Build the uniform candidate shape expected by the UI.
  const candidate: Lead = {
    host: picked.host,
    platform: "web",
    title: picked.title,
    created: new Date().toISOString(),
    temp: "warm",
    why: picked.why,
    supplier_host: normHost(supplier),
  };

  // IMPORTANT guardrail: never return the supplier itself
  if (candidate.host === normHost(supplier)) {
    return res.status(409).json({ error: "refused to return supplier itself" });
  }

  return res.json(candidate);
});

// POST /api/leads/lock   (body = Lead)
router.post("/leads/lock", async (req: Request, res: Response) => {
  const body = req.body || {};
  const host = normHost(body.host || "");
  const title = String(body.title || "").trim();
  const temp: "warm" | "hot" = body.temp === "hot" ? "hot" : "warm";
  const created = body.created && typeof body.created === "string" ? body.created : new Date().toISOString();
  const why = String(body.why || "");
  const supplier_host = normHost(body.supplier_host || "");

  if (!host || !title) return res.status(400).json({ error: "candidate with host and title required" });
  if (host === supplier_host) return res.status(409).json({ error: "cannot lock supplier itself" });

  const lead: Lead = { host, title, temp, created, why, supplier_host, platform: "web" };

  // write to DB if available; otherwise keep in memory (soft-fail, never 5xx)
  try {
    if (pool) {
      // Table suggestion: leads(host text, title text, temp text, created timestamptz, why text, supplier_host text)
      // If your table is different, adapt this one query centrally later.
      await pool.query(
        `insert into leads (host, title, temp, created, why, supplier_host)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (host, title) do update set temp=excluded.temp, created=excluded.created, why=excluded.why`,
        [host, title, temp, created, why, supplier_host]
      );
    } else {
      const key = host + "•" + title;
      lockedMem.set(key, { lead, at: Date.now() });
    }
  } catch (e) {
    // fall back to memory, but still 200 to keep UX smooth
    const key = host + "•" + title;
    lockedMem.set(key, { lead, at: Date.now() });
  }

  return res.status(200).json({ ok: true });
});

export default router;