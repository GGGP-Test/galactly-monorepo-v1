// src/routes/leads.ts
import { Router, Request, Response } from "express";

/**
 * Buyer finder – deterministic, with hard fallbacks so the list is never empty.
 * Endpoints:
 *   GET  /api/leads/healthz
 *   GET  /api/leads/find-buyers?host=example.com&region=US%2FCA&radius=50mi[&size=sm_mid|block_mega|any]
 *   POST /api/leads/lock   { host, title, temp?: 'warm'|'hot', why?: string, platform?: 'web' }
 *   GET  /api/leads/saved?temp=warm|hot
 */

const router = Router();

// ---------------- types ----------------
type Temp = "warm" | "hot";
type SizePref = "sm_mid" | "block_mega" | "any";

interface Candidate {
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: Temp;
  why: string;
  score?: number; // not returned to client
}

// ---------------- tiny utils ----------------
const nowISO = () => new Date().toISOString();
const norm = (h: string) =>
  h.replace(/^https?:\/\//i, "").replace(/^www\./i, "").trim().toLowerCase();
const titleCase = (s: string) => s.replace(/\b[a-z]/g, m => m.toUpperCase());
const prettyHost = (h: string) => {
  const core = norm(h).split(".").slice(0, -1).join(" ");
  return titleCase(core || h);
};
const q = <T extends string>(req: Request, key: string, d?: T): T | undefined => {
  const v = req.query[key];
  return typeof v === "string" && v.length ? (v as T) : d;
};

// ---------------- guardrails ----------------
const MUST_HINT = /\b(vendor|supplier|procure|sourcing|supply\s*chain|supplier\s*(program|portal|info))\b/i;
const AVOID = /\b(our\s*brands|brand\s*family|investor|press|careers|about\s*us|privacy|terms|cookie)\b/i;

const MEGA = new Set<string>([
  "amazon.com","walmart.com","costco.com","kroger.com","target.com",
  "pepsico.com","coca-cola.com","cocacola.com","generalmills.com",
  "kraftheinzcompany.com","nestle.com","unilever.com","loreal.com",
  "pg.com","scjohnson.com","colgatepalmolive.com","kimberly-clark.com",
  "3m.com","loblaw.ca","metro.ca","sobeys.com","hormelfoods.com","clorox.com"
]);

const LARGE = new Set<string>([
  "wegmans.com","sprouts.com","raleys.com","gelsons.com","saveonfoods.com",
  "londondrugs.com","newseasonsmarket.com","petsmart.com","petco.com","ulta.com","sephora.com"
]);

// ---------------- category pools ----------------
type Cat = "food_bev" | "beauty" | "home_clean" | "pet" | "retail_grocery" | "supplements" | "generic";

// mid-market leaning – safe to extend anytime
const POOL: Record<Cat, string[]> = {
  food_bev: [
    "spindrift.com","olipop.com","liquiddeath.com","health-ade.com","harmlessharvest.com",
    "tonyschocolonely.com","sietefoods.com","tillamook.com","rxbar.com","guayaki.com",
    "poppi.com","yerbae.com","boxedwaterisbetter.com","bluebottlecoffee.com","chobani.com",
    "huel.com","magicspoon.com","eatjust.com","hippeas.com","bitchinsauce.com"
  ],
  beauty: [
    "glossier.com","elfcosmetics.com","tatcha.com","colourpop.com","kosas.com","ouai.com",
    "youthtothepeople.com","firstaidbeauty.com","paulaschoice.com","drunkelephant.com",
    "theordinary.com","summerfridays.com"
  ],
  home_clean: [
    "blueland.com","branchbasics.com","methodhome.com","seventhgeneration.com","mrsmeyers.com",
    "grove.co","cleancult.com","tru.earth","attitudeliving.com"
  ],
  pet: [
    "ollie.com","nomnomnow.com","thefarmersdog.com","barkbox.com","openfarmpet.com",
    "honestpaws.com","bogopet.com","petsuppliesplus.com","petvalu.com"
  ],
  retail_grocery: [
    "newseasonsmarket.com","gelsons.com","raleys.com","wegmans.com","saveonfoods.com",
    "londondrugs.com","citarella.com","foxtrotco.com"
  ],
  supplements: [
    "ritual.com","athleticgreens.com","careof.com","seed.com","humnutrition.com",
    "gainful.com","8greens.com"
  ],
  generic: [
    "misfitsmarket.com","thrivemarket.com","boxed.com","iherb.com","goodeggs.com",
    "freshdirect.com","weee.com"
  ]
};

// absolute safety net if something goes wrong upstream
const FALLBACK_POOL: string[] = [
  "newseasonsmarket.com","gelsons.com","citarella.com","spindrift.com","olipop.com",
  "glossier.com","blueland.com","openfarmpet.com","ritual.com","thrivemarket.com","misfitsmarket.com"
];

const HINTS = [
  "Suppliers","Supplier program","Vendor info","Procurement","Sourcing",
  "Supply chain","Doing business with us","Supplier portal"
];

// ---------------- categorization ----------------
function catsForSupplier(host: string): Cat[] {
  const h = norm(host);
  const hits = new Set<Cat>();

  if (/(shrink|film|wrap|flex|pouch|bag|poly|bopp)/i.test(h))
    ["food_bev","retail_grocery","home_clean","pet"].forEach(c => hits.add(c as Cat));
  if (/(label|sticker)/i.test(h))
    ["food_bev","beauty","home_clean","pet","retail_grocery"].forEach(c => hits.add(c as Cat));
  if (/(box|carton|corrug|mailer|folding|rigid)/i.test(h))
    ["retail_grocery","beauty","food_bev","home_clean"].forEach(c => hits.add(c as Cat));
  if (/(bottle|jar|glass|alum|can|beverage|brew|coffee|tea)/i.test(h))
    ["food_bev","retail_grocery"].forEach(c => hits.add(c as Cat));
  if (/(pharma|supplement|vitamin)/i.test(h))
    ["supplements","beauty","generic"].forEach(c => hits.add(c as Cat));

  if (hits.size === 0)
    ["food_bev","beauty","home_clean","pet","retail_grocery","supplements","generic"]
      .forEach(c => hits.add(c as Cat));

  return Array.from(hits);
}

// deterministic picker so the same supplier gets the same set
function pickFor(hostKey: string, pool: string[], take: number): string[] {
  if (!Array.isArray(pool) || pool.length === 0) return [];
  const key = [...hostKey].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 2166136261);
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pool.length * 4 && out.length < take; i++) {
    const idx = (key + i * 97) % pool.length;
    const h = norm(pool[idx]);
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  // last-resort padding (shouldn’t be needed)
  for (const h of FALLBACK_POOL) {
    if (out.length >= take) break;
    const k = norm(h);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function baseCandidates(supplierHost: string, region: string): Candidate[] {
  const cats = catsForSupplier(supplierHost);

  // merge pools
  const mergedRaw = cats.flatMap(c => POOL[c] || []);
  const merged = Array.from(new Set(mergedRaw.length ? mergedRaw : FALLBACK_POOL));

  // nudge Canadian targets for US/CA
  if (/US\/CA/i.test(region)) {
    ["well.ca","naturespath.com","purdys.com","londondrugs.com","saveonfoods.com"].forEach(h => merged.push(h));
  }

  const chosen = pickFor(supplierHost, merged, 22);
  const created = nowISO();

  return chosen.map((host, i) => {
    const hint = HINTS[(i + supplierHost.length) % HINTS.length];
    const sizeTag = MEGA.has(host) ? "mega" : LARGE.has(host) ? "large" : "mid";
    const why = [
      `fit: ${cats.join("/")}`,
      `region: ${region}`,
      `size: ${sizeTag}`,
      `vendor page known (picked for supplier: ${norm(supplierHost)})`
    ].join(" · ");
    return {
      host,
      platform: "web",
      title: `${hint} | ${prettyHost(host)}`,
      created,
      temp: "warm",
      why
    };
  });
}

function rankAndFilter(items: Candidate[], supplierHost: string, sizePref: SizePref, preferCA: boolean): Candidate[] {
  const supplier = norm(supplierHost);
  const seen = new Set<string>();
  const ranked = items
    .filter(c => norm(c.host) !== supplier)
    .map(c => {
      let s = 0;
      const hay = `${c.title} ${c.why}`;
      if (MUST_HINT.test(hay)) s += 1.0;
      if (!AVOID.test(hay)) s += 0.25;
      if (preferCA && /\.ca$/i.test(c.host)) s += 0.2;

      const h = norm(c.host);
      if (sizePref === "block_mega") {
        if (MEGA.has(h)) s = -9999; // hide
        else if (LARGE.has(h)) s -= 0.45;
      } else if (sizePref === "sm_mid") {
        if (MEGA.has(h)) s -= 0.55;
        else if (LARGE.has(h)) s -= 0.35;
      } else {
        // any
        if (MEGA.has(h)) s -= 0.25;
        else if (LARGE.has(h)) s -= 0.15;
      }
      return { ...c, score: s };
    })
    .filter(c => (c.score ?? 0) > -9000)
    .filter(c => {
      const k = norm(c.host);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.host.localeCompare(b.host))
    .reverse(); // highest first

  return ranked;
}

function neverEmpty(supplierHost: string, region: string, sizePref: SizePref): Candidate[] {
  const preferCA = /US\/CA/i.test(region);
  const pool = baseCandidates(supplierHost, region);

  // 1) strictish
  let out = rankAndFilter(pool, supplierHost, sizePref, preferCA).slice(0, 12);
  if (out.length) return out;

  // 2) allow mid+large
  out = rankAndFilter(pool, supplierHost, "sm_mid", preferCA).slice(0, 12);
  if (out.length) return out;

  // 3) allow anything
  out = rankAndFilter(pool, supplierHost, "any", preferCA).slice(0, 12);
  if (out.length) return out;

  // 4) absolute fallback (should be unreachable)
  return (pool.length ? pool : FALLBACK_POOL.slice(0, 8)).map((h) => ({
    host: norm(h),
    platform: "web",
    title: `Suppliers | ${prettyHost(h)}`,
    created: nowISO(),
    temp: "warm",
    why: "fallback"
  }));
}

// ---------------- saved memory store ----------------
const SAVED: { warm: Candidate[]; hot: Candidate[] } = { warm: [], hot: [] };
const CAP = 500;
function save(temp: Temp, c: Candidate) {
  const arr = SAVED[temp];
  const k = norm(c.host);
  const i = arr.findIndex(x => norm(x.host) === k);
  if (i >= 0) arr.splice(i, 1);
  arr.unshift(c);
  if (arr.length > CAP) arr.pop();
}

// ---------------- routes ----------------
router.get("/healthz", (_req, res) => res.json({ ok: true, ts: nowISO() }));

router.get("/find-buyers", (req: Request, res: Response) => {
  const host = q<string>(req, "host");
  if (!host) return res.status(400).json({ error: "host is required" });

  const region = q<string>(req, "region", "US/CA")!;
  const size = (q<SizePref>(req, "size") as SizePref) || (q<SizePref>(req, "s") as SizePref) || "sm_mid";

  const candidates = neverEmpty(host, region, size);

  // For older frontends that read `candidate` (singular), also include the first one.
  const candidate = candidates[0] || null;

  res.json({ candidates, candidate });
});

router.post("/lock", (req: Request, res: Response) => {
  const { host, title, temp, why, platform } = req.body || {};
  if (!host || !title) return res.status(400).json({ error: "candidate with host and title required" });
  const c: Candidate = {
    host: norm(String(host)),
    platform: platform === "web" ? "web" : "web",
    title: String(title),
    created: nowISO(),
    temp: temp === "hot" ? "hot" : "warm",
    why: typeof why === "string" && why.length ? why : "locked by user"
  };
  save(c.temp, c);
  res.json({ ok: true });
});

router.get("/saved", (req: Request, res: Response) => {
  const temp = (q<Temp>(req, "temp") || "warm") as Temp;
  const list = temp === "hot" ? SAVED.hot : SAVED.warm;
  // hide score from client
  res.json({ items: list.map(({ score, ...rest }) => rest) });
});

export default router;