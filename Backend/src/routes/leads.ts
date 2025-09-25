import { Router, Request, Response } from "express";

let pool: any = null;
try {
  pool = require("../shared/db").pool; // single canonical path (unchanged)
} catch { /* optional DB */ }

const router = Router();

/** ------------ Types & in-memory fallback ------------- */
type Temp = "warm" | "hot";
type Lead = {
  host: string;
  platform?: string;
  title: string;
  created: string;
  temp: Temp;
  why?: string;
  supplier_host?: string;
};
const lockedMem = new Map<string, { lead: Lead; at: number }>();
const TTL_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of lockedMem) if (now - v.at > TTL_MS) lockedMem.delete(k);
}, 10 * 60 * 1000);

/** ---------------- Helpers (no regex flags) ---------------- */
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

/** ------------ Very light category guess from supplier host ------------ */
type Vertical = "CPG" | "Food" | "Beverage" | "Beauty" | "Household" | "Retail" | "Apparel" | "Pet";
function guessVertical(supplierHost: string): Vertical[] {
  const s = supplierHost.toLowerCase();
  const tags: Vertical[] = ["CPG"];
  if (s.includes("brew") || s.includes("coffee") || s.includes("tea") || s.includes("drink") || s.includes("bever")) tags.unshift("Beverage");
  if (s.includes("snack") || s.includes("food")) tags.unshift("Food");
  if (s.includes("pet")) tags.unshift("Pet");
  if (s.includes("beauty") || s.includes("cosmetic") || s.includes("skincare")) tags.unshift("Beauty");
  if (s.includes("home") || s.includes("clean")) tags.unshift("Household");
  if (s.includes("shop") || s.includes("retail")) tags.unshift("Retail");
  if (s.includes("apparel") || s.includes("wear")) tags.unshift("Apparel");
  return Array.from(new Set(tags));
}

/** ---------------- Tier A/B seed pool (reliable) ---------------- */
type Buyer = { host: string; pages: { path: string; title: string }[]; tier: "A" | "B"; vertical: Vertical };
const BUYERS_AB: Buyer[] = [
  { host: "clorox.com", tier: "A", vertical: "Household", pages: [{ path: "/suppliers", title: "Suppliers & procurement | Clorox" }] },
  { host: "hormelfoods.com", tier: "A", vertical: "Food", pages: [{ path: "/supplier", title: "Supplier / vendor info | Hormel Foods" }] },
  { host: "generalmills.com", tier: "A", vertical: "Food", pages: [{ path: "/suppliers", title: "Suppliers | General Mills" }] },
  { host: "kraftheinzcompany.com", tier: "A", vertical: "Food", pages: [{ path: "/procurement", title: "Procurement | Kraft Heinz" }] },
  { host: "pepsico.com", tier: "A", vertical: "Beverage", pages: [{ path: "/suppliers", title: "Supplier portal | PepsiCo" }] },
  { host: "mondelezinternational.com", tier: "A", vertical: "Food", pages: [{ path: "/suppliers", title: "Suppliers | Mondelēz International" }] },
  { host: "nestle.com", tier: "A", vertical: "Food", pages: [{ path: "/suppliers", title: "Suppliers | Nestlé" }] },
  { host: "pandg.com", tier: "A", vertical: "Household", pages: [{ path: "/suppliers", title: "Suppliers | P&G" }] },
  { host: "johnsonandjohnson.com", tier: "A", vertical: "Beauty", pages: [{ path: "/business/partner-with-us", title: "Partner with us | J&J" }] },
  { host: "churchdwight.com", tier: "B", vertical: "Household", pages: [{ path: "/suppliers", title: "Suppliers | Church & Dwight" }] },
  { host: "campbellsoupcompany.com", tier: "B", vertical: "Food", pages: [{ path: "/suppliers", title: "Suppliers | Campbell Soup" }] },
  { host: "postholdings.com", tier: "B", vertical: "Food", pages: [{ path: "/suppliers", title: "Suppliers | Post Holdings" }] },
];

/** ---------------- Tier C pool (smaller/regional brands) ----------------
 * These typically lack formal supplier portals; we return a partnership/
 * wholesale/contact-oriented title so the UI has a clean label to lock.
 */
type MicroBuyer = { host: string; title: string; vertical: Vertical };
const BUYERS_C: MicroBuyer[] = [
  // Beverage/D2C
  { host: "liquiddeath.com", title: "Partnerships & operations", vertical: "Beverage" },
  { host: "olipop.com", title: "Partnerships & sourcing", vertical: "Beverage" },
  { host: "poppi.co", title: "Partnerships & vendor", vertical: "Beverage" },
  { host: "guayaki.com", title: "Supplier / partner", vertical: "Beverage" },
  // Food/Snacks
  { host: "perfectsnacks.com", title: "Operations / packaging", vertical: "Food" },
  { host: "bhufoods.com", title: "Vendor / sourcing", vertical: "Food" },
  { host: "huel.com", title: "Supply & packaging", vertical: "Food" },
  // Beauty
  { host: "drunkelephant.com", title: "Packaging & sourcing", vertical: "Beauty" },
  { host: "theordinary.com", title: "Supplier / operations", vertical: "Beauty" },
  // Household / cleaning
  { host: "methodhome.com", title: "Packaging & logistics", vertical: "Household" },
  { host: "blueland.com", title: "Operations / vendor", vertical: "Household" },
  // Pet
  { host: "thefarmersdog.com", title: "Operations / packaging", vertical: "Pet" },
  { host: "chewy.com", title: "Private label packaging", vertical: "Pet" },
  // Regional grocers / retail (mixed volume, good pack buyers)
  { host: "sprouts.com", title: "Own brand packaging", vertical: "Retail" },
  { host: "wegmans.com", title: "Private label packaging", vertical: "Retail" },
  { host: "heb.com", title: "Own brand packaging", vertical: "Retail" },
];

/** ----------------- Picking logic ----------------- */
function pickBuyer(
  supplierHost: string,
  opts: { tier?: "A" | "B" | "C"; depth?: "shallow" | "deep" }
): { host: string; title: string; why: string } | null {
  const sup = normHost(supplierHost);
  const wantedTier = opts.tier;
  const deep = opts.depth === "deep";
  const verticalPref = guessVertical(supplierHost);

  // Build candidate lists by vertical affinity, excluding the supplier host.
  const abPool = BUYERS_AB
    .filter(b => b.host !== sup && (!wantedTier || b.tier === wantedTier))
    .filter(b => verticalPref.includes(b.vertical))
    .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "A" ? -1 : 1));

  const cPool = BUYERS_C
    .filter(b => b.host !== sup && verticalPref.includes(b.vertical));

  // Priority: explicit tier → A/B → (if deep) C
  if (wantedTier === "C" || deep) {
    const pool = (wantedTier === "C" ? cPool : cPool.concat([]));
    if (pool.length) {
      const chosen = pool[Math.floor(Math.random() * Math.min(pool.length, 6))];
      return {
        host: chosen.host,
        title: chosen.title,
        why: `Tier C ${chosen.vertical}; inferred partnerships buyer (picked for supplier: ${sup})`
      };
    }
  }

  if (abPool.length) {
    const chosen = abPool[Math.floor(Math.random() * Math.min(abPool.length, 6))];
    const page = chosen.pages[0];
    return {
      host: chosen.host,
      title: page.title,
      why: `Tier ${chosen.tier} ${chosen.vertical}; supplier program (picked for supplier: ${sup})`
    };
  }

  // As a last resort, hand back a sane generic on the most related Tier C
  if (cPool.length) {
    const chosen = cPool[0];
    return {
      host: chosen.host,
      title: chosen.title || `Partnerships / vendor`,
      why: `Tier C ${chosen.vertical}; generic partnerships (supplier: ${sup})`
    };
  }

  return null;
}

/** ----------------- API ----------------- */
// GET /api/leads/find-buyers?host=...&tier=A|B|C&depth=deep
router.get("/leads/find-buyers", (req: Request, res: Response) => {
  const supplier = String(req.query.host || "").trim();
  if (!supplier) return res.status(400).json({ error: "host is required" });

  const tierQ = String(req.query.tier || "").toUpperCase();
  const depthQ = String(req.query.depth || "").toLowerCase();
  const tier: "A" | "B" | "C" | undefined =
    tierQ === "A" || tierQ === "B" || tierQ === "C" ? (tierQ as any) : undefined;
  const depth: "shallow" | "deep" = depthQ === "deep" ? "deep" : "shallow";

  const picked = pickBuyer(supplier, { tier, depth });
  if (!picked) return res.status(404).json({ error: "no match" });

  const candidate: Lead = {
    host: picked.host,
    platform: "web",
    title: picked.title || `Buyer lead for ${normHost(supplier)}`,
    created: new Date().toISOString(),
    temp: "warm",
    why: picked.why,
    supplier_host: normHost(supplier),
  };

  if (candidate.host === normHost(supplier)) {
    return res.status(409).json({ error: "refused to return supplier itself" });
  }

  return res.json(candidate);
});

// POST /api/leads/lock
router.post("/leads/lock", async (req: Request, res: Response) => {
  const body = req.body || {};
  const host = normHost(body.host || "");
  const title = String(body.title || "").trim();
  const temp: Temp = body.temp === "hot" ? "hot" : "warm";
  const created = body.created && typeof body.created === "string" ? body.created : new Date().toISOString();
  const why = String(body.why || "");
  const supplier_host = normHost(body.supplier_host || "");

  if (!host || !title) return res.status(400).json({ error: "candidate with host and title required" });
  if (host === supplier_host) return res.status(409).json({ error: "cannot lock supplier itself" });

  const lead: Lead = { host, title, temp, created, why, supplier_host, platform: "web" };

  try {
    if (pool) {
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
  } catch {
    const key = host + "•" + title;
    lockedMem.set(key, { lead, at: Date.now() });
  }

  return res.status(200).json({ ok: true });
});

export default router;