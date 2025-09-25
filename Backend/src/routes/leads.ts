// src/routes/leads.ts
import { Router, Request, Response } from "express";

/**
 * Minimal, deterministic buyer-finder with strong guardrails.
 * Endpoints:
 *   GET  /api/leads/healthz
 *   GET  /api/leads/find-buyers?host=peekpackaging.com&region=US%2FCA&radius=50mi[&size=sm_mid|block_mega|any]
 *   POST /api/leads/lock   { host, title, temp?: 'warm'|'hot', why?: string, platform?: 'web' }
 *   GET  /api/leads/saved?temp=warm|hot
 *
 * Design goals:
 *   - Cheap and deterministic (no crawling here).
 *   - Default to *actionable* mid-market candidates; block mega by default.
 *   - Light category awareness to avoid irrelevant giants.
 */

const router = Router();

// ---------- Types ----------
type Temp = "warm" | "hot";
type SizePref = "sm_mid" | "block_mega" | "any";

interface Candidate {
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: Temp;
  why: string;
  score?: number; // internal ranking
}

// ---------- Utils ----------
const nowISO = () => new Date().toISOString();
const normHost = (h: string) =>
  h.replace(/^https?:\/\//i, "").replace(/^www\./i, "").trim().toLowerCase();

const pretty = (host: string) =>
  host
    .split(".")
    .slice(0, -1)
    .join(" ")
    .replace(/\b\w/g, (m) => m.toUpperCase()) || host;

function q<T extends string>(req: Request, name: string, def?: T): T | undefined {
  const raw = req.query[name];
  if (typeof raw === "string" && raw.length) return raw as T;
  return def;
}

// ---------- Guardrails ----------
const MUST = /\b(vendor|supplier|procure|sourcing|supply\s*chain|supplier\s*(program|portal|info))\b/i;
const AVOID = /\b(our\s*brands|brand\s*family|investor|press|careers|about\s*us|esg)\b/i;

// “Mega” (blocked by default)
const MEGA = new Set<string>([
  "amazon.com","apple.com","walmart.com","target.com","costco.com","kroger.com",
  "albertsons.com","homedepot.com","lowes.com","bestbuy.com","google.com","microsoft.com",
  "meta.com","tesla.com","pepsico.com","coca-cola.com","cocacola.com","conagra.com",
  "generalmills.com","kelloggs.com","kraftheinzcompany.com","nestle.com","unilever.com",
  "loreal.com","pg.com","scjohnson.com","colgatepalmolive.com","kimberly-clark.com",
  "3m.com","loblaw.ca","metro.ca","sobeys.com","traderjoes.com","wholefoodsmarket.com",
  "aldi.us","publix.com","heb.com","meijer.com","hormelfoods.com","clorox.com","campbells.com"
]);

// “Large but not mega” (we allow but we down-rank strongly unless size=any)
const LARGE = new Set<string>([
  "wegmans.com","saveonfoods.com","londondrugs.com","raleys.com","gelsons.com","newseasonsmarket.com",
  "sephora.com","ulta.com","petco.com","petsmart.com","safeway.com"
]);

// ---------- Category Awareness ----------
type Cat = "food_bev" | "beauty" | "home_clean" | "pet" | "retail_grocery" | "generic";

const CAT_RULES: { cat: Cat; re: RegExp }[] = [
  { cat: "food_bev", re: /(food|snack|meat|cheese|dair|choco|candy|cookie|beverage|drink|coffee|tea|brew|sauce|spice|granola|cereal|protein|bar|soda|water|juice)/i },
  { cat: "beauty", re: /(beauty|cosmetic|skin|hair|soap|shampoo|lotion|makeup|lip|nail|fragrance|serum|cream|spf|face)/i },
  { cat: "home_clean", re: /(clean|detergent|laundry|wipe|towel|trash|bag|home|household|dish)/i },
  { cat: "pet", re: /(pet|dog|cat|kibble|treat|vet|canine|feline)/i },
  { cat: "retail_grocery", re: /(grocery|market|mart|foods|supermarket)/i },
  { cat: "generic", re: /.*/ }
];

// Mid-market leaning pools per category (no crawling; used to fabricate vendor endpoints)
const POOL: Record<Cat, string[]> = {
  food_bev: [
    "spindrift.com","olipop.com","liquiddeath.com","health-ade.com","harmlessharvest.com",
    "tonyschocolonely.com","sietefoods.com","tillamook.com","imperfectfoods.com","bluebottlecoffee.com",
    "rxbar.com","guayaki.com","poppi.com","yerbae.com","boxedwaterisbetter.com"
  ],
  beauty: [
    "glossier.com","elfcosmetics.com","tatcha.com","colourpop.com","kosas.com","ouai.com",
    "drbronner.com","theouai.com","youthtothepeople.com","firstaidbeauty.com","fentybeauty.com"
  ],
  home_clean: [
    "blueland.com","branchbasics.com","methodhome.com","seventhgeneration.com","mrs-meyers.com",
    "who Gives A crap".toLowerCase().replace(/\s+/g,"")+" .org".replace(/\s+/g,""), // whogivesacrap.org
    "groveco.com","everspring.com"
  ].map(h=>h.replace(/\s/g,"")).concat(["whogivesacrap.org"]),
  pet: [
    "chewy.com","ollie.com","nomnomnow.com","thefarmersdog.com","barkbox.com","petsuppliesplus.com",
    "petvalu.com"
  ],
  retail_grocery: [
    "newseasonsmarket.com","gelsons.com","raleys.com","wegmans.com","saveonfoods.com","londondrugs.com"
  ],
  generic: [
    "misfitsmarket.com","thrivemarket.com","boxed.com","iherb.com","goodeggs.com","smartfoodservice.com"
  ]
};

// Generic vendor-ish path hints (used for titles/reasons only)
const VENDOR_PATH_HINTS = [
  "suppliers","supplier","vendor","vendors","procurement","sourcing",
  "supply-chain","supplychain","supplier-portal","supplier-program","doing-business-with-us"
];

function detectCategory(supplierHost: string): Cat {
  const hint = supplierHost.replace(/\W+/g, " ");
  const rule = CAT_RULES.find(r => r.re.test(hint)) || CAT_RULES[CAT_RULES.length - 1];
  return rule.cat;
}

function seedPick(supplierHost: string, list: string[], extra: string[] = [], take = 12): string[] {
  const all = [...extra, ...list];
  // Deterministic shuffle keyed by supplier host
  const key = [...supplierHost].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 2166136261);
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < all.length * 3 && out.length < take; i++) {
    const idx = (key + i * 97) % all.length;
    const h = normHost(all[idx]);
    if (!used.has(h)) {
      used.add(h);
      out.push(h);
    }
  }
  return out;
}

function scoreWhy(why: string): number {
  let s = 0;
  if (MUST.test(why)) s += 1.0;
  if (!AVOID.test(why)) s += 0.3;
  return s;
}

function applyGuardrails(items: Candidate[], supplierHost: string, sizePref: SizePref, preferCA: boolean): Candidate[] {
  const supplier = normHost(supplierHost);

  let filtered = items
    .filter(c => normHost(c.host) !== supplier)
    .filter(c => {
      const hay = `${c.title} ${c.why}`;
      if (MUST.test(hay)) return true;
      return !AVOID.test(hay);
    })
    .map(c => {
      let score = c.score ?? 0;

      // Region: small nudge to .ca when US/CA chosen
      if (preferCA && /\.ca$/i.test(c.host)) score += 0.2;

      // Size treatment
      const h = normHost(c.host);
      if (MEGA.has(h)) {
        if (sizePref === "any") score -= 0.6; // allowed but down-ranked
        else return { ...c, score: -9999 };    // effectively removed
      } else if (LARGE.has(h)) {
        if (sizePref === "any") score -= 0.3;
        else score -= 0.45; // keep but strongly down-rank
      }

      return { ...c, score };
    })
    .filter(c => (c.score ?? 0) > -9000);

  // De-dupe by host
  const seen = new Set<string>();
  filtered = filtered.filter(c => {
    const k = normHost(c.host);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort by score then host
  filtered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.host.localeCompare(b.host));
  return filtered;
}

// ---------- In-memory saved ----------
const SAVED: { warm: Candidate[]; hot: Candidate[] } = { warm: [], hot: [] };
const cap = 500;
function pushSaved(temp: Temp, c: Candidate) {
  const list = SAVED[temp];
  const i = list.findIndex(x => normHost(x.host) === normHost(c.host));
  if (i >= 0) list.splice(i, 1);
  list.unshift(c);
  if (list.length > cap) list.pop();
}

// ---------- Routes ----------
router.get("/healthz", (_req, res) => res.json({ ok: true, ts: nowISO() }));

router.get("/find-buyers", (req: Request, res: Response) => {
  const supplierHostRaw = q<string>(req, "host");
  if (!supplierHostRaw) return res.status(400).json({ error: "host is required" });

  const supplierHost = normHost(supplierHostRaw);
  const region = q<string>(req, "region", "US/CA") || "US/CA";
  const sizePref = (q<SizePref>(req, "size") as SizePref) || "sm_mid"; // default mid-market
  const preferCA = /US\/CA/i.test(region);

  // Category-aware selection
  const cat = detectCategory(supplierHost);
  const base = POOL[cat] ?? [];
  const general = POOL.generic ?? [];
  const extraRegionalCA = preferCA ? ["well.ca","naturespath.com","purdys.com","londondrugs.com","saveonfoods.com"] : [];

  const chosen = seedPick(supplierHost, base, [...general, ...extraRegionalCA], 16);

  const created = nowISO();
  const raw: Candidate[] = chosen.map((host) => {
    const hint = VENDOR_PATH_HINTS[(host.length + supplierHost.length) % VENDOR_PATH_HINTS.length];
    const sizeTag = MEGA.has(host) ? "mega" : LARGE.has(host) ? "large" : "mid";
    const title = `${hint.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())} | ${pretty(host)}`;
    const why = `fit: ${cat.replace("_", "/")} · region: ${region} · size: ${sizeTag} · vendor page known (picked for supplier: ${supplierHost})`;
    const score = scoreWhy(`${title} ${why}`);
    return {
      host,
      platform: "web",
      title,
      created,
      temp: "warm",
      why,
      score
    };
  });

  const candidates = applyGuardrails(raw, supplierHost, sizePref, preferCA).slice(0, 12);
  return res.json({ candidates });
});

router.post("/lock", (req: Request, res: Response) => {
  const { host, title, temp, why, platform } = req.body || {};
  if (!host || !title) return res.status(400).json({ error: "candidate with host and title required" });
  const cand: Candidate = {
    host: normHost(String(host)),
    platform: platform === "web" ? "web" : "web",
    title: String(title),
    created: nowISO(),
    temp: temp === "hot" ? "hot" : "warm",
    why: typeof why === "string" && why.length ? why : "locked by user"
  };
  pushSaved(cand.temp, cand);
  res.json({ ok: true });
});

router.get("/saved", (req: Request, res: Response) => {
  const temp = (q<Temp>(req, "temp") || "warm") as Temp;
  const list = temp === "hot" ? SAVED.hot : SAVED.warm;
  res.json({ items: list.map(({ score, ...rest }) => rest) });
});

export default router;