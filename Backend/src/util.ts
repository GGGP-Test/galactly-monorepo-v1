import type { Heat, Region } from './types.js';

// Massive keyword dictionaries to classify packaging leads
export const CAT_DICT: Record<string,string[]> = {
  Flexible: [
    'pouch','stand-up pouch','gusset','rollstock','ldpe','hdpe','cpp','opp','laminate','film','foil','barrier bag','vacuum bag','zipper','spout pouch','retort','shrink film','poly bag','die-cut poly','mylar'
  ],
  Corrugated: [
    'corrugated','rsc','mailer box','shipper','die-cut mailer','flute','e-flute','b-flute','carton','tray and insert','litho-lam','kraft','sbs','whiteboard','short-run carton','folding carton'
  ],
  Labels: [
    'label','sticker','roll label','sheet label','ghs','thermal transfer','direct thermal','bopp','ul label','tamper-evident','serial label','barcode','rfid label'
  ],
  Crating: [
    'pallet','ispm-15','crate','export crate','skid','heat treated','wood packaging','crate design','cnc crate','foam-in-place','palletization'
  ]
};

export const REGION_HINTS: Record<Region,string[]> = {
  US: ['usa','u.s.','united states','ca, usa','ny','tx','california','sam.gov','fbo'],
  Canada: ['canada','ontario','bc','alberta','quebec','canadabuys','merx'],
  Other: []
};

export function classify(text: string) {
  const t = text.toLowerCase();
  let cat = 'Flexible';
  let kw = '';
  for (const [c, arr] of Object.entries(CAT_DICT)) {
    for (const k of arr) {
      if (t.includes(k)) { cat = c; kw = k; break; }
    }
  }
  if (!kw) kw = text.split(/\s+/).slice(0,3).join(' ').toLowerCase();
  return { cat, kw };
}

export function heatFromSource(source: string): Heat {
  const s = source.toLowerCase();
  if (s.includes('sam.gov')) return 'HOT';
  if (s.includes('reddit')) return 'WARM';
  return 'OK';
}

export function clamp(n:number,min:number,max:number){return Math.max(min,Math.min(max,n));}

export function fitScore(base: number, boost=0){
  return clamp(Math.round(base + boost), 60, 99);
}
