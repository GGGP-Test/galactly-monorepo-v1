// src/shared/lexicon.ts
//
// Single source of truth for taxonomy + safe auto-growth.
// No external deps. Other modules import from here.
//
// Exports:
// - getLexicon(): snapshot of all lists
// - addLearned(kind, token): safe in-memory add (auto-learning uses this)
// - promoteLearned(): merge learned -> core (in-memory)
// - bootstrapFromEnv(): merge JSON from env/file if present (optional, safe)
// - onGoodResult(tags: string[]): simple heuristic to feed addLearned()
//
// Kinds: 'vertical' | 'overlay' | 'product' | 'query:micro|small|medium|large'

/* eslint-disable @typescript-eslint/no-explicit-any */

type KindBase = "vertical" | "overlay" | "product";
type SizeQ = "micro" | "small" | "medium" | "large";
type Kind = KindBase | `query:${SizeQ}`;

const MAX_TOKEN_LEN = 48;

function cleanToken(tok: string): string {
  const t = String(tok || "").toLowerCase().trim()
    .replace(/[^a-z0-9 +\-_/&]/g, " ")
    .replace(/\s+/g, " ");
  return t.slice(0, MAX_TOKEN_LEN);
}

function uniqMerge(dst: string[], src: string[], cap = 999): string[] {
  const seen = new Set(dst.map(cleanToken).filter(Boolean));
  for (const s of src) {
    const c = cleanToken(s);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    dst.push(c);
    if (dst.length >= cap) break;
  }
  return dst;
}

/* ---------------------- core (hand-curated, safe) ------------------------- */

const verticalsSmall: string[] = [
  "cafe","coffee shop","bakery","cupcake shop","donut shop","gelato shop",
  "ice cream shop","juice bar","tea shop","boba tea","sandwich shop",
  "delicatessen","restaurant","pizzeria","food truck","caterer","meal prep",
  "ghost kitchen","butcher shop","seafood market","greengrocer",
  "grocery","corner store","mini market","convenience store","farm stand",
  "farmers market vendor","coffee roaster","artisan chocolate","candy shop",
  "snack brand","baked goods brand","sauce company","hot sauce brand",
  "jam and preserves","condiments brand","spice company","tea brand",
  "supplement brand","vitamin brand","niche cosmetics brand","candle company",
  "soap company","etsy shop","small ecommerce brand","shipping store",
  "pack and ship","print and ship","mailing center","independent bookstore",
  "machine shop","print shop","screen printing","t-shirt printing",
  "craft brewery taproom","nano brewery",
  "small warehouse","micro warehouse","micro fulfillment","self storage business",
  "local 3pl","local third party logistics","parcel fulfillment center",
  "pet boutique","pet store","health food store","natural foods store",
  "bottle shop","wine shop","liquor store","vape shop","dispensary"
];

const verticalsMidLarge: string[] = [
  "wholesale bakery","commissary kitchen","food manufacturer","snack manufacturer",
  "frozen foods plant","meat processor","seafood processor","dairy processor",
  "cheese manufacturer","coffee roastery","coffee distributor","tea importer",
  "beverage co-packer","craft brewery","brewery production","distillery production",
  "winery production","bottling line","cosmetics manufacturer","skincare manufacturer",
  "contract manufacturer cosmetics","nutraceutical manufacturer","supplement manufacturer",
  "vitamin packager","personal care manufacturer","ecommerce fulfillment center",
  "order fulfillment center","regional 3pl","third party logistics","returns center",
  "kitting center","co-packer","contract packager","repackaging service",
  "food distributor","beverage distributor","wholesale foods","wholesale beverage",
  "produce distributor","meat distributor","seafood distributor","dairy distributor",
  "frozen distributor","broadline distributor","distribution center","cross dock",
  "cold storage warehouse","temperature controlled warehouse","ambient warehouse",
  "bonded warehouse","regional grocery chain","regional convenience store chain",
  "regional restaurant chain","franchise operator","pet food manufacturer",
  "household goods manufacturer","electronics assembly","medical device assembly",
  "apparel fulfillment","shoe fulfillment","printing and labeling service",
  "label converter","flexographic printer",
  // large industrial intents that also appear in mid when smaller ops exist:
  "national distribution center","automated stretch wrap line","shrink tunnel line",
  "case packing line","form fill seal line","thermoforming line",
  "contract packaging facility","high speed bottling","food processing plant",
  "chemical distributor","fibc bulk bag user"
];

const productIntents: string[] = [
  "stretch film","stretch wrap","pallet wrap","hand wrap","machine wrap",
  "shrink film","shrink wrap","shrink tunnel","heat tunnel",
  "void fill","air pillows","bubble wrap","foam-in-place","packing peanuts",
  "tape dispenser","tape gun","case tape","strapping","strapping machine",
  "palletizing","pallet banding","poly bag","poly mailer","mailer bag",
  "zipper pouch","stand up pouch","labels and printing","thermal labels",
  "ribbon printing","label applicator","corrugated boxes","custom corrugate",
  "mailers","box supplier","fibc bulk bags","bulk sacks","drum liners",
  "packaging automation","carton erector","case sealer","conveyor system",
  "weighing and filling","form fill seal"
];

const overlaysPersona: string[] = [
  "local","multi-location","franchise","ecommerce","wholesale","retail",
  "cold chain","hazmat","food safe","kosher","organic","gluten free"
];

// queries for Google/OSM by size
const queries: Record<SizeQ, string[]> = {
  micro: [
    "home bakery","cottage bakery","home-based food business",
    "farmers market seller","etsy seller","craft seller","cottage foods"
  ],
  small: [...verticalsSmall, ...productIntents],
  medium: [...verticalsMidLarge, ...productIntents],
  large: [
    "national distribution center","mega distribution center","big box retail distribution center",
    "omnichannel fulfillment center","third party logistics campus","national 3pl",
    "ecommerce mega fulfillment","cold chain logistics hub","high-bay warehouse",
    "automated stretch wrap line","shrink tunnel line","case packing line","form fill seal line",
    "thermoforming line","contract packaging facility","high speed bottling","food processing plant"
  ]
};

/* ---------------------- learned (auto-growth) ------------------------------ */

const learned = {
  vertical: new Set<string>(),
  overlay: new Set<string>(),
  product: new Set<string>(),
  query: {
    micro: new Set<string>(),
    small: new Set<string>(),
    medium: new Set<string>(),
    large: new Set<string>()
  }
};

export function addLearned(kind: Kind, token: string): boolean {
  const t = cleanToken(token);
  if (!t) return false;

  // simple guardrails: max words 6; must contain a letter
  if (!/[a-z]/.test(t) || t.split(" ").length > 6) return false;

  if (kind === "vertical") learned.vertical.add(t);
  else if (kind === "overlay") learned.overlay.add(t);
  else if (kind === "product") learned.product.add(t);
  else {
    const sz = kind.split(":")[1] as SizeQ;
    if (learned.query[sz]) learned.query[sz].add(t);
    else return false;
  }
  return true;
}

export function promoteLearned(): void {
  uniqMerge(verticalsSmall, Array.from(learned.vertical));
  uniqMerge(overlaysPersona, Array.from(learned.overlay));
  uniqMerge(productIntents, Array.from(learned.product));
  (Object.keys(learned.query) as SizeQ[]).forEach(sz => {
    uniqMerge(queries[sz], Array.from(learned.query[sz]));
  });
  // reset learned after merge
  Object.values(learned.query).forEach(s => s.clear());
  learned.vertical.clear(); learned.overlay.clear(); learned.product.clear();
}

export function getLexicon() {
  return {
    verticalsSmall: verticalsSmall.slice(),
    verticalsMidLarge: verticalsMidLarge.slice(),
    productIntents: productIntents.slice(),
    overlaysPersona: overlaysPersona.slice(),
    queries: {
      micro: queries.micro.slice(),
      small: queries.small.slice(),
      medium: queries.medium.slice(),
      large: queries.large.slice()
    }
  };
}

/* ---------------- optional bootstrap (safe if missing) -------------------- */

function readMaybe(p?: string): any {
  if (!p) return null;
  try { return require(p); } catch { return null; }
}

// If LEXICON_JSON or LEXICON_FILE are set, merge once on import.
export function bootstrapFromEnv(): void {
  try {
    const blob = process.env.LEXICON_JSON ? JSON.parse(String(process.env.LEXICON_JSON)) : null;
    const file = readMaybe(process.env.LEXICON_FILE || "");
    const data = blob || file;
    if (!data) return;
    if (Array.isArray(data.verticalsSmall)) uniqMerge(verticalsSmall, data.verticalsSmall, 5000);
    if (Array.isArray(data.verticalsMidLarge)) uniqMerge(verticalsMidLarge, data.verticalsMidLarge, 5000);
    if (Array.isArray(data.productIntents)) uniqMerge(productIntents, data.productIntents, 5000);
    if (Array.isArray(data.overlaysPersona)) uniqMerge(overlaysPersona, data.overlaysPersona, 5000);
    if (data.queries && typeof data.queries === "object") {
      (["micro","small","medium","large"] as SizeQ[]).forEach(sz => {
        if (Array.isArray(data.queries[sz])) uniqMerge(queries[sz], data.queries[sz], 5000);
      });
    }
  } catch { /* ignore */ }
}
bootstrapFromEnv();

/* --------- tiny helper: feed from successful results automatically -------- */
// This can be called by routes after a good find/explain.
// It extracts clean tags and promotes common packaging words.
const WHITELIST = new Set<string>([
  "shopify","woocommerce","wordpress","wix","squarespace",
  "rfq","pricing","checkout","cart","buy","phone","email",
  "stretch wrap","shrink wrap","void fill","palletizing","corrugated boxes",
  "labels and printing","poly bag","fibc bulk bags"
]);

export function onGoodResult(tags: string[]): void {
  const seen = new Set<string>();
  for (const raw of Array.isArray(tags) ? tags : []) {
    const t = cleanToken(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (WHITELIST.has(t)) addLearned("product", t);
  }
}