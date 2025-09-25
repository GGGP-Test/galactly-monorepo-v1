// src/routes/leads.ts
import { Router, Request, Response } from "express";

/**
 * Deterministic buyer finder with robust fallbacks.
 * Endpoints:
 *   GET  /api/leads/healthz
 *   GET  /api/leads/find-buyers?host=peekpackaging.com&region=US%2FCA&radius=50mi[&size=sm_mid|block_mega|any]
 *   POST /api/leads/lock   { host, title, temp?: 'warm'|'hot', why?: string, platform?: 'web' }
 *   GET  /api/leads/saved?temp=warm|hot
 *
 * Strategy:
 *   1) Pick category pools likely relevant to packaging suppliers.
 *   2) Fabricate vendor-ish endpoints safely (no crawling).
 *   3) Rank with guardrails; NEVER return empty: progressively relax if needed.
 */

const router = Router();

// ---------------- Types ----------------
type Temp = "warm" | "hot";
type SizePref = "sm_mid" | "block_mega" | "any";

interface Candidate {
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: Temp;
  why: string;
  score?: number;
}

// ---------------- Utils ----------------
const nowISO = () => new Date().toISOString();
const norm = (h: string) => h.replace(/^https?:\/\//i, "").replace(/^www\./i, "").trim().toLowerCase();
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (m) => m.toUpperCase());
const prettyHost = (h: string) => {
  const core = norm(h).split(".").slice(0, -1).join(" ");
  return titleCase(core || h);
};
const q = <T extends string>(req: Request, name: string, def?: T): T | undefined => {
  const v = req.query[name];
  return typeof v === "string" && v.length ? (v as T) : def;
};

// ---------------- Guardrails ----------------
const MUST_HINT = /\b(vendor|supplier|procure|sourcing|supply\s*chain|supplier\s*(program|portal|info))\b/i;
const AVOID = /\b(our\s*brands|brand\s*family|investor|press|careers|about\s*us|privacy|terms|cookie)\b/i;

const MEGA = new Set<string>([
  // very large
  "amazon.com","apple.com","walmart.com","target.com","costco.com","kroger.com","albertsons.com",
  "homedepot.com","lowes.com","bestbuy.com","google.com","microsoft.com","meta.com","tesla.com",
  "pepsico.com","coca-cola.com","cocacola.com","conagra.com","generalmills.com","kelloggs.com",
  "kraftheinzcompany.com","nestle.com","unilever.com","loreal.com","pg.com","scjohnson.com",
  "colgatepalmolive.com","kimberly-clark.com","3m.com","loblaw.ca","metro.ca","sobeys.com",
  "traderjoes.com","wholefoodsmarket.com","aldi.us","publix.com","heb.com","meijer.com",
  "hormelfoods.com","clorox.com","campbells.com"
]);

const LARGE = new Set<string>([
  // large but not mega
  "wegmans.com","saveonfoods.com","londondrugs.com","raleys.com","gelsons.com","newseasonsmarket.com",
  "sprouts.com","safeway.com","ulta.com","sephora.com","petco.com","petsmart.com"
]);

// ---------------- Categories & Pools ----------------
type Cat = "food_bev" | "beauty" | "home_clean" | "pet" | "retail_grocery" | "supplements" | "generic";

// mid-market leaning examples; safe to expand anytime
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

// vendor-ish titles (we don’t actually fetch pages here)
const HINTS = [
  "Suppliers","Supplier program","Vendor info","Procurement","Sourcing","Supply chain",
  "Doing business with us","Supplier portal"
];

// Categories to try for a given supplier host (fan-out when unsure)
function catsForSupplier(host: string): Cat[] {
  const h = norm(host);
  const hits = new Set<Cat>();
  if (/(shrink|film|wrap|flex|pouch|bag|poly|bopp)/i.test(h)) {
    ["food_bev","retail_grocery","home_clean","pet"].forEach(c => hits.add(c as Cat));
  }
  if (/(label|sticker)/i.test(h)) {
    ["food_bev","beauty","home_clean","pet","retail_grocery"].forEach(c => hits.add(c as Cat));
  }
  if (/(box|carton|corrug|mailer|folding|rigid)/i.test(h)) {
    ["retail_grocery","beauty","food_bev","home_clean"].forEach(c => hits.add(c as Cat));
  }
  if (/(bottle|jar|glass|alum|can|beverage|brew|coffee|tea)/i.test(h)) {
    ["food_bev","retail_grocery"].forEach(c => hits.add(c as Cat));
  }
  if (/(pharma|supplement|vitamin)/i.test(h)) {
    ["supplements","beauty","generic"].forEach(c => hits.add(c as Cat));
  }
  // default fan-out if nothing matched
  if (hits.size === 0) {
    ["food_bev","beauty","home_clean","pet","retail_grocery","supplements","generic"]
      .forEach(c => hits.add(c as Cat));
  }
  return Array.from(hits);
}

// deterministic shuffle keyed by supplier host
function pickFor(hostKey: string, pool: string[], take: number): string[] {
  const key = [...hostKey].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 2166136261);
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pool.length * 3 && out.length < take; i++) {
    const idx = (key + i * 97) % pool.length;
    const h = norm(pool[idx]);
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

function baseCandidates(supplierHost: string, region: string): Candidate[] {
  const cats = catsForSupplier(supplierHost);
  // unify pools from several categories to avoid empties
  const merged: string[] = Array.from(
    new Set(
      cats.flatMap((c) => POOL[c] || []).concat(POOL.generic || [])
    )
  );

  const preferCA = /US\/CA/i.test(region);
  if (preferCA) {
    // nudge some Canadian targets
    ["well.ca","naturespath.com","purdys.com","londondrugs.com","saveonfoods.com"].forEach((h) =>
      merged.push(h)
    );
  }

  const chosen = pickFor(supplierHost, merged, 22);
  const created = nowISO();

  return chosen.map((host, i) => {
    const hint = HINTS[(i + supplierHost.length) % HINTS.length];
    const sizeTag = MEGA.has(host) ? "mega" : LARGE.has(host) ? "large" : "mid";
    const whyBits = [
      `fit: ${cats.join("/")}`,
      `region: ${region}`,
      `size: ${sizeTag}`,
      `vendor page known (picked for supplier: ${norm(supplierHost)})`,
    ];
    return {
      host,
      platform: "web",
      title: `${hint} | ${prettyHost(host)}`,
      created,
      temp: "warm",
      why: whyBits.join(" · "),
    };
  });
}

function rankAndFilter(items: Candidate[], supplierHost: string, sizePref: SizePref, preferCA: boolean): Candidate[] {
  const supplier = norm(supplierHost);
  const seen = new Set<string>();
  const ranked = items
    .filter((c) => norm(c.host) !== supplier)
    .map((c) => {
      let s = 0;
      const hay = `${c.title} ${c.why}`;
      if (MUST_HINT.test(hay)) s += 1.0;
      if (!AVOID.test(hay)) s += 0.25;
      if (preferCA && /\.ca$/i.test(c.host)) s += 0.2;

      const h = norm(c.host);
      if (sizePref === "block_mega") {
        if (MEGA.has(h)) s = -9999; // hard hide
        else if (LARGE.has(h)) s -= 0.45;
      } else if (sizePref === "sm_mid") {
        if (MEGA.has(h)) s -= 0.55;      // keep but push down a lot
        else if (LARGE.has(h)) s -= 0.35; // down-rank
      } else {
        // any: light touch only
        if (MEGA.has(h)) s -= 0.25;
        else if (LARGE.has(h)) s -= 0.15;
      }
      return { ...c, score: s };
    })
    .filter((c) => (c.score ?? 0) > -9000)
    .filter((c) => {
      const k = norm(c.host);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.host.localeCompare(b.host));

  return ranked;
}

function neverEmpty(
  supplierHost: string,
  region: string,
  originalSize: SizePref
): Candidate[] {
  const preferCA = /US\/CA/i.test(region);

  // 1) strictish
  let pool = baseCandidates(supplierHost, region);
  let out = rankAndFilter(pool, supplierHost, originalSize, preferCA).slice(0, 12);
  if (out.length) return out;

  // 2) allow large (still down-ranked)
  out = rankAndFilter(pool, supplierHost, "sm_mid", preferCA).slice(0, 12);
  if (out.length) return out;

  // 3) allow ANY (mega included, lightly penalized)
  out = rankAndFilter(pool, supplierHost, "any", preferCA).slice(0, 12);
  if (out.length) return out;

  // 4) absolute fallback: return first few raw (shouldn’t happen)
  return pool.slice(0, 8);
}

// ---------------- In-memory saved ----------------
const SAVED: { warm: Candidate[]; hot: Candidate[] } = { warm: [], hot: [] };
const SAVED_CAP = 500;

function save(temp: Temp, c: Candidate) {
  const list = SAVED[temp];
  const k = norm(c.host);
  const i = list.findIndex((x) => norm(x.host) === k);
  if (i >= 0) list.splice(i, 1);
  list.unshift(c);
  if (list.length > SAVED_CAP) list.pop();
}

// ---------------- Routes ----------------
router.get("/healthz", (_req, res) => res.json({ ok: true, ts: nowISO() }));

router.get("/find-buyers", (req: Request, res: Response) => {
  const host = q<string>(req, "host");
  if (!host) return res.status(400).json({ error: "host is required" });

  const region = q<string>(req, "region", "US/CA")!;
  const size = (q<SizePref>(req, "size") as SizePref) || "sm_mid";

  const candidates = neverEmpty(host, region, size);
  return res.json({ candidates });
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
    why: typeof why === "string" && why.length ? why : "locked by user",
  };
  save(c.temp, c);
  res.json({ ok: true });
});

router.get("/saved", (req: Request, res: Response) => {
  const temp = (q<Temp>(req, "temp") || "warm") as Temp;
  const list = temp === "hot" ? SAVED.hot : SAVED.warm;
  res.json({ items: list.map(({ score, ...rest }) => rest) });
});

export default router;