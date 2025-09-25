// src/shared/trc.ts
// Tier-C “rule packs” for laser-personalized SMB buyer discovery.
// Safe to ship standalone. Nothing imports this yet.
// Next step: wire selectPacksForSupplier + scoreTierC() inside leads.ts.
//
// You can securely extend/override these packs by setting TRC_PACKS_JSON
// (a JSON object with { packs: TrcPack[] } ) in your deployment secrets.
//
// Example TRC_PACKS_JSON value:
// {
//   "packs":[
//     {"id":"local-jewelry-la","label":"Local Jewelry (Los Angeles)",
//      "tierFocus":["C"],"cityTags":["los angeles","la","culver city","pasadena"],
//      "segTags":["jewelry","retail"],"must":["jewelry","jeweller","jewelry store"],
//      "should":["custom","engraving","boutique","gift"],"avoid":["distributor","wholesale only"],
//      "platformHints":["shopify","woocommerce","wix"],"size":{"employeesMax":50},
//      "warmCues":["wholesale","private label"],"hotCues":["grand opening","pop-up","new collection"]}
//   ]
// }

export type Tier = 'A'|'B'|'C';

export interface SizeHint {
  employeesMin?: number;
  employeesMax?: number;
  revenueMinUSD?: number;
  revenueMaxUSD?: number;
}

export interface TrcPack {
  id: string;                 // unique key
  label: string;              // human label
  tierFocus: Tier[];          // which tiers this pack targets
  segTags: string[];          // high-level segments (e.g., "bakery","coffee")
  cityTags?: string[];        // boost cities/areas (lowercased)
  must?: string[];            // at least one must be present to consider HOT eligibility
  should?: string[];          // positive tokens (title/text/desc)
  avoid?: string[];           // negatives – penalize/ban
  warmCues?: string[];        // words that imply “willing to buy” (wholesale, private label)
  hotCues?: string[];         // words that imply “now-ish” (grand opening, pre-order, launch)
  platformHints?: ('shopify'|'woocommerce'|'wix'|'squarespace'|'bigcommerce'|'etsy')[];
  naics?: string[];           // informative only (if you enrich from company DBs later)
  size?: SizeHint;            // target size envelope (Tier-C default small)
  // free-form notes for future maintainers
  notes?: string;
}

// ---------- utility: normalization ----------

export function norm(s?: string) {
  return (s||'').toLowerCase().trim();
}
export function words(s?: string) {
  return norm(s).split(/[^a-z0-9\+]+/).filter(Boolean);
}
export function normalizeCity(s?: string) {
  return norm(s).replace(/\./g,'').replace(/\s+/g,' ');
}

// simple contains (whole-word or substring heuristic)
function textHasAny(text: string, list?: string[]) {
  if (!list || list.length===0) return false;
  const t = norm(text);
  return list.some(k => t.includes(norm(k)));
}

// ---------- built-in curated Tier-C packs ----------
// Focused on SMB retail/F&B/DTC/local-service buyers that commonly need packaging.

const BUILTIN: TrcPack[] = [
  // F&B retail
  { id:'bakery-local', label:'Local Bakery / Patisserie', tierFocus:['C'],
    segTags:['bakery','food','retail'], cityTags:[],
    must:['bakery','patisserie','bakeshop'],
    should:['custom cake','cupcake','macaron','pastry','artisan','gluten free','wedding cake','catering'],
    avoid:['wholesale distributor','equipment supplier','ingredient distributor'],
    platformHints:['shopify','woocommerce','wix','squarespace'],
    warmCues:['catering','wholesale','private label','subscription'],
    hotCues:['grand opening','soft opening','pre-order','holiday menu','seasonal menu','new location'],
    size:{employeesMax:50, revenueMaxUSD:10000000},
    naics:['445291','311811'],
    notes:'Boxes, cake circles, pastry clamshells, labels, custom sleeves'
  },
  { id:'coffee-local', label:'Coffee Roaster / Café', tierFocus:['C'],
    segTags:['coffee','cafe','beverage'], cityTags:[],
    must:['coffee','roaster','cafe','espresso'],
    should:['roastery','single origin','subscription','cold brew','k-cup','pour over'],
    avoid:['equipment wholesaler','green bean importer','espresso repair'],
    platformHints:['shopify','woocommerce','squarespace'],
    warmCues:['wholesale','white label','private label','subscription'],
    hotCues:['new roast','limited release','grand opening','now open','pre-order'],
    size:{employeesMax:80, revenueMaxUSD:20000000},
    naics:['445299','311920'],
    notes:'Bags, labels, shipper cartons, sample sachets'
  },
  { id:'tea-local', label:'Tea Shop / Blender', tierFocus:['C'],
    segTags:['tea','beverage','retail'],
    must:['tea','matcha','herbal tea'],
    should:['loose leaf','blend','subscription','ceremony','teahouse'],
    avoid:['tea equipment wholesaler'],
    platformHints:['shopify','woocommerce','wix'],
    warmCues:['wholesale','private label'],
    hotCues:['limited batch','seasonal blend','grand opening'],
    size:{employeesMax:50, revenueMaxUSD:8000000},
    naics:['445299','311920']
  },
  { id:'brewery', label:'Craft Brewery / Taproom', tierFocus:['C'],
    segTags:['beverage','alcohol','brewery'],
    must:['brewery','taproom','beer'],
    should:['crowler','growler','can release','can drop','lager','ipa','stout'],
    avoid:['beer distributor','macro brewery'],
    platformHints:['shopify','woocommerce'],
    warmCues:['wholesale','private label','co-pack'],
    hotCues:['can release','new can art','limited release','new location'],
    size:{employeesMax:100, revenueMaxUSD:30000000},
    naics:['312120']
  },
  { id:'winery', label:'Winery / Tasting Room', tierFocus:['C'],
    segTags:['beverage','alcohol','winery'],
    must:['winery','vineyard','tasting room'],
    should:['estate','vintage','club','case special'],
    avoid:['wine distributor','auction house'],
    platformHints:['shopify','woocommerce','squarespace'],
    warmCues:['club','wholesale','private label'],
    hotCues:['harvest','release','wine club shipment'],
    size:{employeesMax:80, revenueMaxUSD:25000000},
    naics:['312130']
  },
  { id:'distillery', label:'Craft Distillery', tierFocus:['C'],
    segTags:['beverage','alcohol','distillery'],
    must:['distillery','spirits','tasting room'],
    should:['small batch','bottle release','barrel','cocktail'],
    avoid:['liquor distributor'],
    platformHints:['shopify','woocommerce'],
    warmCues:['private label','co-pack','wholesale'],
    hotCues:['bottle release','limited edition'],
    size:{employeesMax:80, revenueMaxUSD:25000000},
    naics:['312140']
  },

  // Food CPG (small)
  { id:'cpg-snacks', label:'Small CPG Snacks / Confectionery', tierFocus:['C'],
    segTags:['cpg','snacks','confectionery'],
    must:['snack','chips','granola','candy','chocolate','confection'],
    should:['vegan','keto','gluten free','protein','bar','trail mix'],
    avoid:['ingredient wholesaler','machinery'],
    platformHints:['shopify','woocommerce'],
    warmCues:['wholesale','private label','pallet','case pack'],
    hotCues:['retail launch','restock','new flavor','now at'],
    size:{employeesMax:100, revenueMaxUSD:30000000},
    naics:['311340','311351','311352']
  },
  { id:'cpg-condiments', label:'Sauces / Condiments / Pickles', tierFocus:['C'],
    segTags:['cpg','sauces','foods'],
    must:['sauce','hot sauce','salsa','ketchup','mustard','dressing','pickle','kimchi'],
    should:['small batch','artisan','fermented','co-pack','jar'],
    avoid:['foodservice broadline distributor'],
    platformHints:['shopify','woocommerce','wix'],
    warmCues:['wholesale','private label','co-pack'],
    hotCues:['farmers market','new jar','retail launch'],
    size:{employeesMax:60, revenueMaxUSD:15000000},
    naics:['311999']
  },
  { id:'bakery-icecream', label:'Ice Cream / Gelato Shop', tierFocus:['C'],
    segTags:['ice cream','dessert','retail'],
    must:['ice cream','gelato','sorbet'],
    should:['pint','scoop shop','seasonal flavor'],
    avoid:['equipment service'],
    platformHints:['squarespace','wix'],
    warmCues:['wholesale','private label'],
    hotCues:['grand opening','new flavor','pint release'],
    size:{employeesMax:40, revenueMaxUSD:8000000}
  },

  // Beauty / Personal care
  { id:'beauty-indie', label:'Indie Beauty / Skincare', tierFocus:['C'],
    segTags:['beauty','skincare','cosmetics'],
    must:['skincare','skin care','serum','balm','lotion','cosmetics','makeup'],
    should:['clean beauty','vegan','cruelty free','indie','handmade','apothecary'],
    avoid:['raw ingredient supplier','contract manufacturer only'],
    platformHints:['shopify','woocommerce','etsy','wix'],
    warmCues:['wholesale','private label','subscription'],
    hotCues:['new launch','limited batch','collab'],
    size:{employeesMax:60, revenueMaxUSD:15000000},
    naics:['325620','446120']
  },
  { id:'candle', label:'Candles / Home Fragrance', tierFocus:['C'],
    segTags:['candle','home fragrance','gift'],
    must:['candle','soy candle','wax melt'],
    should:['hand-poured','small batch','studio','apothecary','home fragrance'],
    avoid:['bulk importer','raw wax supplier'],
    platformHints:['shopify','etsy','woocommerce','wix'],
    warmCues:['wholesale','private label','white label'],
    hotCues:['holiday drop','limited run','market'],
    size:{employeesMax:30, revenueMaxUSD:5000000},
    naics:['339999']
  },
  { id:'soap', label:'Soap / Bath & Body', tierFocus:['C'],
    segTags:['soap','bath','body','gift'],
    must:['soap','handmade soap','bath bomb','body butter'],
    should:['small batch','artisan','cold process','apothecary'],
    avoid:['ingredient wholesaler'],
    platformHints:['etsy','shopify','wix'],
    warmCues:['wholesale','private label'],
    hotCues:['new scent','market','gift set'],
    size:{employeesMax:30, revenueMaxUSD:5000000}
  },

  // Pets
  { id:'pet-treats', label:'Pet Treats / Pet Boutique', tierFocus:['C'],
    segTags:['pet','treats','retail'],
    must:['pet','dog','cat','treat','pet boutique'],
    should:['grooming','boutique','raw','freeze dried','functional'],
    avoid:['pet food distributor'],
    platformHints:['shopify','woocommerce','wix'],
    warmCues:['wholesale','private label'],
    hotCues:['grand opening','new flavor'],
    size:{employeesMax:50, revenueMaxUSD:10000000}
  },

  // Apparel / accessories
  { id:'apparel-boutique', label:'Apparel Boutique / Streetwear', tierFocus:['C'],
    segTags:['apparel','boutique','fashion'],
    must:['boutique','streetwear','clothing store','apparel'],
    should:['drop','lookbook','capsule','graphic tee','brand'],
    avoid:['screen printer service only','wholesale only marketplace'],
    platformHints:['shopify','woocommerce','wix'],
    warmCues:['wholesale'],
    hotCues:['drop','collection release','pop-up'],
    size:{employeesMax:50, revenueMaxUSD:15000000}
  },
  { id:'jewelry-boutique', label:'Jewelry Boutique / Maker', tierFocus:['C'],
    segTags:['jewelry','gift','retail'],
    must:['jewelry','jeweller','jewelry store'],
    should:['handmade','studio','artisan','goldsmith','silversmith'],
    avoid:['wholesale distributor only'],
    platformHints:['shopify','etsy','squarespace','wix'],
    warmCues:['wholesale','consignment'],
    hotCues:['trunk show','market','new collection'],
    size:{employeesMax:25, revenueMaxUSD:3000000}
  },

  // Flowers / gifts
  { id:'florist', label:'Florist / Flower Boutique', tierFocus:['C'],
    segTags:['florist','gift','event'],
    must:['florist','flower shop','floral'],
    should:['wedding','event','bouquet','delivery'],
    avoid:['wholesale flower market'],
    platformHints:['squarespace','wix'],
    warmCues:['wedding season','event'],
    hotCues:['grand opening','valentine','mother\'s day'],
    size:{employeesMax:30, revenueMaxUSD:5000000}
  },
  { id:'gift-shop', label:'Gift Shop / Stationery', tierFocus:['C'],
    segTags:['gift','stationery','home goods'],
    must:['gift shop','stationery','paper goods','cards'],
    should:['boutique','local maker','artisan','letterpress'],
    avoid:['print trade only'],
    platformHints:['shopify','squarespace','wix','etsy'],
    warmCues:['wholesale'],
    hotCues:['holiday market','grand opening'],
    size:{employeesMax:30, revenueMaxUSD:5000000}
  },

  // Health local services
  { id:'dental-clinic', label:'Dental / Ortho Clinic (Local)', tierFocus:['C'],
    segTags:['medical','dental','clinic','local'],
    must:['dental','dentist','orthodontic','oral surgery'],
    should:['new patients','invisalign','braces'],
    avoid:['lab supplier','equipment dealer'],
    platformHints:['squarespace','wix','wordpress'],
    warmCues:['welcome kit','patient kit'],
    hotCues:['grand opening','new location'],
    size:{employeesMax:50, revenueMaxUSD:10000000}
  },
  { id:'medspa', label:'MedSpa / Aesthetics Clinic', tierFocus:['C'],
    segTags:['medspa','aesthetics','clinic'],
    must:['medspa','aesthetic','injectable','laser'],
    should:['skincare line','retail','membership'],
    avoid:['equipment reseller'],
    platformHints:['squarespace','wix','wordpress'],
    warmCues:['retail skincare','membership box'],
    hotCues:['grand opening','open house'],
    size:{employeesMax:40, revenueMaxUSD:8000000}
  },

  // Markets & DTC maker economy
  { id:'farmers-market-vendor', label:'Farmers Market Vendors', tierFocus:['C'],
    segTags:['market','local','cpg','craft'],
    must:['farmers market','craft market','artisan market'],
    should:['vendor list','booth','pop-up','maker'],
    avoid:['venue management only'],
    platformHints:['instagram','shopify','etsy'],
    warmCues:['wholesale','stockists'],
    hotCues:['market schedule','new vendor'],
    size:{employeesMax:20, revenueMaxUSD:2000000}
  },
  { id:'etsy-topical', label:'Etsy/DTC Makers (Packaging-heavy)', tierFocus:['C'],
    segTags:['etsy','maker','dtc'],
    must:['etsy.com/shop','etsy shop'],
    should:['branding','labels','stickers','candles','bath','jewelry','soap'],
    avoid:[],
    platformHints:['etsy'],
    warmCues:['wholesale','custom order'],
    hotCues:['drop','restock'],
    size:{employeesMax:10, revenueMaxUSD:1000000}
  },

  // Industrial-ish SMBs needing corrugated/shipper packs
  { id:'electronics-acc', label:'Small Electronics Accessories', tierFocus:['C'],
    segTags:['electronics','accessories','dtc'],
    must:['case','accessories','charger','dock','cable','mousepad','keyboard'],
    should:['brand','warranty','retail box','unboxing'],
    avoid:['distributor only','B2B only catalog'],
    platformHints:['shopify','woocommerce','bigcommerce'],
    warmCues:['wholesale'],
    hotCues:['new model','drop'],
    size:{employeesMax:100, revenueMaxUSD:40000000}
  },
  { id:'supplements-indie', label:'Indie Supplements / Nutraceutical', tierFocus:['C'],
    segTags:['supplements','health','cpg'],
    must:['supplement','capsule','gummy','powder','preworkout','protein'],
    should:['clean label','indie brand','gmp','co-pack'],
    avoid:['raw ingredient supplier','bulk contract manufacturer only'],
    platformHints:['shopify','woocommerce'],
    warmCues:['wholesale','private label','co-pack'],
    hotCues:['launch','new flavor','stack'],
    size:{employeesMax:80, revenueMaxUSD:30000000},
    naics:['325411']
  },

  // Restaurants / meal prep
  { id:'restaurant-local', label:'Indie Restaurant / Cafe', tierFocus:['C'],
    segTags:['restaurant','foodservice','local'],
    must:['restaurant','cafe','eatery','bistro','taqueria','pizzeria','ramen','noodle','bbq','diner'],
    should:['takeout','to-go','catering','meal prep','ghost kitchen'],
    avoid:['restaurant supply wholesaler','aggregators'],
    platformHints:['wordpress','wix','squarespace'],
    warmCues:['catering','meal prep','holiday menu'],
    hotCues:['grand opening','soft opening','new location'],
    size:{employeesMax:60, revenueMaxUSD:12000000}
  },
  { id:'meal-prep', label:'Meal Prep / Ghost Kitchen', tierFocus:['C'],
    segTags:['meal prep','ghost kitchen','foodservice'],
    must:['meal prep','prepped meals','macro','weekly menu'],
    should:['subscription','delivery','athlete','keto','high protein'],
    avoid:['aggregator marketplace'],
    platformHints:['shopify','squarespace','wix'],
    warmCues:['subscription','wholesale'],
    hotCues:['new menu','new facility'],
    size:{employeesMax:40, revenueMaxUSD:8000000}
  },

  // Printing / promo shops (often source packaging)
  { id:'local-print', label:'Local Print / Sign / Promo Shop', tierFocus:['C'],
    segTags:['print','sign','promo'],
    must:['print shop','printing','sign shop','screen print','embroidery'],
    should:['packaging','boxes','labels','kitting','fulfillment'],
    avoid:['trade-only print broker'],
    platformHints:['wordpress','wix'],
    warmCues:['wholesale','white label'],
    hotCues:['new location','expanded services'],
    size:{employeesMax:50, revenueMaxUSD:10000000}
  },

  // Pharma-lite (OTC / clinics with retail area)
  { id:'clinic-retail', label:'Clinic with Retail (OTC/Wellness)', tierFocus:['C'],
    segTags:['clinic','retail','wellness'],
    must:['clinic','retail','apothecary','supplement','wellness'],
    should:['dispensary','front desk retail','boutique'],
    avoid:['hospital systems','distributors'],
    platformHints:['squarespace','wordpress'],
    warmCues:['private label','white label'],
    hotCues:['grand opening','now open'],
    size:{employeesMax:80, revenueMaxUSD:20000000}
  },

  // E-com generalist SMBs
  { id:'dtc-general', label:'DTC Shopify/Woo SMB', tierFocus:['C'],
    segTags:['dtc','ecommerce','retail'],
    must:['cart','add to cart','shop','buy now'],
    should:['unboxing','brand','bundle','set'],
    avoid:['marketplace only'],
    platformHints:['shopify','woocommerce','bigcommerce','squarespace','wix'],
    warmCues:['wholesale','stockists','private label'],
    hotCues:['drop','launch','restock'],
    size:{employeesMax:120, revenueMaxUSD:50000000}
  },

  // Packaging-heavy craft niches
  { id:'chocolate-artisan', label:'Artisan Chocolate / Bean-to-Bar', tierFocus:['C'],
    segTags:['chocolate','confection','gift'],
    must:['chocolate','bean to bar','truffle','bonbon','confection'],
    should:['craft','artisan','single origin','cacao'],
    avoid:['ingredient supplier'],
    platformHints:['shopify','squarespace','wix'],
    warmCues:['wholesale','wedding','corporate gifting'],
    hotCues:['holiday collection','valentine','easter'],
    size:{employeesMax:40, revenueMaxUSD:8000000}
  },
  { id:'brew-soda-kombucha', label:'Kombucha / Craft Soda', tierFocus:['C'],
    segTags:['beverage','kombucha','soda'],
    must:['kombucha','soda','sparkling','fermented tea'],
    should:['taproom','bottle','can','growler'],
    avoid:['equipment distributor'],
    platformHints:['shopify','woocommerce'],
    warmCues:['wholesale','private label'],
    hotCues:['flavor drop','new bottle'],
    size:{employeesMax:60, revenueMaxUSD:12000000}
  },

  // Stationery / packaging-adjacent
  { id:'stationery-brand', label:'Stationery / Stickers / Labels (SMB)', tierFocus:['C'],
    segTags:['stationery','stickers','labels'],
    must:['sticker','stationery','planner','label'],
    should:['foil','holographic','die cut','merch'],
    avoid:['trade only'],
    platformHints:['etsy','shopify','woocommerce'],
    warmCues:['wholesale','stockists'],
    hotCues:['drop','restock'],
    size:{employeesMax:25, revenueMaxUSD:3000000}
  },
];

// ---------- secure extension & merge ----------

function parseEnvPacks(): TrcPack[] {
  try {
    const raw = process.env.TRC_PACKS_JSON;
    if (!raw) return [];
    const obj = JSON.parse(raw);
    const packs = Array.isArray(obj?.packs) ? obj.packs : [];
    return packs.filter(p => p && p.id && p.label) as TrcPack[];
  } catch {
    return [];
  }
}

function mergePacks(): TrcPack[] {
  const ext = parseEnvPacks();
  if (!ext.length) return BUILTIN;
  const map = new Map<string, TrcPack>();
  for (const p of BUILTIN) map.set(p.id, p);
  for (const p of ext) map.set(p.id, { ...map.get(p.id), ...p });
  return Array.from(map.values());
}

const ALL = mergePacks();

// ---------- selection for a supplier ----------

export interface SupplierHint {
  host?: string;
  supplierTags?: string[]; // e.g., ['labels','cartons','corrugated','beauty']
  productTags?: string[];  // optional synonyms
  city?: string;
  minTier?: Tier;          // 'C' -> prefer TierC packs
}

export function selectPacksForSupplier(hint: SupplierHint, max = 6): TrcPack[] {
  const tags = new Set<string>((hint.supplierTags||[]).map(norm).concat((hint.productTags||[]).map(norm)));
  const wantTier = hint.minTier || 'C';
  const city = normalizeCity(hint.city);

  // score packs by overlap with supplier tags + tier fit + city boost
  const scored = ALL.map(p => {
    let s = 0;
    // tier preference
    if (wantTier==='C' && p.tierFocus.includes('C')) s += 20;
    if (wantTier==='B' && p.tierFocus.includes('B')) s += 10;
    if (wantTier==='A' && p.tierFocus.includes('A')) s += 5;

    // tag overlap
    for (const t of p.segTags) if (tags.has(norm(t))) s += 8;

    // city hint
    if (city && p.cityTags && p.cityTags.some(c => normalizeCity(c)===city)) s += 6;

    return { pack:p, score:s };
  }).sort((a,b)=>b.score-a.score);

  // always include some general DTC/Restaurant/Local fallback to keep recall
  const base = new Set<string>(['dtc-general','restaurant-local','local-print']);
  const picks: TrcPack[] = [];
  for (const row of scored) {
    if (row.score<=0) continue;
    picks.push(row.pack);
    if (picks.length>=max) break;
  }
  for (const id of base) {
    if (!picks.find(p=>p.id===id)) {
      const pk = ALL.find(p=>p.id===id);
      if (pk) picks.push(pk);
    }
  }
  return picks.slice(0, max);
}

// ---------- scoring of a candidate against packs ----------

export interface CandidateLike {
  host: string;
  title?: string;
  snippet?: string; // body/description if available
  city?: string;
  employees?: number;
  revenueUSD?: number;
  tags?: string[]; // inferred tags like ['shopify','restaurant']
  platform?: string; // 'shopify','woocommerce', etc.
}

export interface ScoreOpts {
  excludeGiants?: boolean; // when true, penalize very big companies hard
}

export function scoreTierC(
  candidate: CandidateLike,
  packs: TrcPack[],
  opts: ScoreOpts = {}
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const text = `${candidate.title||''} ${candidate.snippet||''}`.toLowerCase();

  // platform/tag hints
  const tags = new Set<string>((candidate.tags||[]).concat(candidate.platform? [candidate.platform] : []));

  for (const p of packs) {
    let local = 0;

    // must (if any pack has must, presence boosts a lot)
    if (p.must && p.must.length>0 && textHasAny(text,p.must)) {
      local += 24; reasons.push(`must(${p.id})`);
    }

    // should tokens
    if (textHasAny(text,p.should)) { local += 8; reasons.push(`should(${p.id})`); }

    // warm/hot cues add small boosts (classification hint)
    if (textHasAny(text,p.warmCues)) { local += 6; reasons.push(`warmcue(${p.id})`); }
    if (textHasAny(text,p.hotCues))  { local += 10; reasons.push(`hotcue(${p.id})`); }

    // avoid tokens
    if (textHasAny(text,p.avoid)) { local -= 12; reasons.push(`avoid(${p.id})`); }

    // platform hint alignments
    if (p.platformHints && p.platformHints.some(ph => tags.has(ph))) { local += 6; reasons.push(`platform(${p.id})`); }

    // city proximity
    if (candidate.city && p.cityTags && p.cityTags.map(normalizeCity).includes(normalizeCity(candidate.city))) {
      local += 6; reasons.push(`city(${p.id})`);
    }

    // size window
    if (p.size) {
      const emp = candidate.employees || 0;
      const rev = candidate.revenueUSD || 0;
      if (p.size.employeesMax && emp>0 && emp<=p.size.employeesMax) { local += 5; reasons.push(`emp-fit(${p.id})`); }
      if (p.size.revenueMaxUSD && rev>0 && rev<=p.size.revenueMaxUSD) { local += 5; reasons.push(`rev-fit(${p.id})`); }
    }

    score += local;
  }

  // Optional global giant penalty
  if (opts.excludeGiants) {
    if ((candidate.revenueUSD||0) > 500_000_000) {
      score -= 120; reasons.push('penalty:giant');
    } else if ((candidate.employees||0) > 1000) {
      score -= 60; reasons.push('penalty:large-headcount');
    }
  }

  return { score, reasons };
}

// ---------- export pack registry for diagnostics ----------

export function allTrcPacks(): TrcPack[] { return ALL; }
export function findPack(id: string): TrcPack|undefined { return ALL.find(p=>p.id===id); }