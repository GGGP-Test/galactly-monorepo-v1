// src/shared/promo.ts
//
// Promo / urgency detector (deterministic; zero deps).
// Looks for SALES, coupons/codes, limited-time language, deadlines,
// "ends in N days", free shipping, BOGO, clearance, launches, banners.
//
// Exports:
//   assessPromo(pages) -> PromoSignal
//   assessPagePromo(page) -> PromoFlags
//   mergePromoFlags(list) -> PromoFlags
//   brief(signal) -> string
//
// Shapes:
//   type PromoPage = { url: string; html?: string; text?: string }
//   type PromoFlags = {... counters & captured values ...}
//   type PromoSignal = {
//     confidence: number; reasons: string[]; hasPromo: boolean;
//     promoCodes: string[]; deadlinesIso: string[]; endsInDays: number | null;
//     flags: PromoFlags
//   }

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PromoPage = { url: string; html?: string; text?: string };

export type PromoFlags = {
  saleHits: number;
  clearanceHits: number;
  bogoHits: number;
  couponWords: number;
  promoCodes: Set<string>;
  freeShipHits: number;
  launchHits: number;   // "launch", "now available", "introducing"
  newHits: number;      // "new", "just dropped", "new collection"
  deadlineDates: string[];     // absolute dates parsed to ISO (yyyy-mm-dd)
  deadlinePhrases: number;     // "ends Friday"/"until Sunday"/"today only"
  countdownHits: number;       // "ends in X days"/"X days left"/"countdown"
  limitedHits: number;         // "limited time", "while supplies last"
  bannerHints: number;         // "banner"/"hero"/"promo" class/alt
  endsInDaysMentions: number[];// numeric ends-in days extracted
};

export type PromoSignal = {
  confidence: number;       // 0..100
  reasons: string[];
  hasPromo: boolean;
  promoCodes: string[];
  deadlinesIso: string[];
  endsInDays: number | null;
  flags: PromoFlags;
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const lc = (s: any) => String(s ?? "").toLowerCase();

function safeText(html?: string, text?: string): string {
  if (text) return String(text);
  const h = String(html || "");
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function count(re: RegExp, s: string, cap = 200): number {
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const m = s.match(rx);
  return m ? Math.min(m.length, cap) : 0;
}

/* ------------------------------ regexes -------------------------------- */

// Sales / promo language
const RE_SALE     = /\b(sale|save\s+\d+%|save\s+\$\d+|%+\s*off|\$\s?\d+\s*off|markdowns?)\b/ig;
const RE_CLEAR    = /\b(clearance|closeout|final\s+sale)\b/ig;
const RE_BOGO     = /\b(bogo|buy\s+one\s+get\s+one|2\s*for\s*1)\b/ig;
const RE_COUPON   = /\b(coupon|promo\s*code|discount\s*code|use\s*code|apply\s*code)\b/ig;
const RE_CODE_CAP = /\b(?:use\s*code|code)\s*[:\-]?\s*([A-Z0-9]{4,14})\b/g;
const RE_FREESHIP = /\b(free\s+shipping|ships\s+free|free\s+delivery)\b/ig;

const RE_LIMITED  = /\b(limited\s+time|limited\s+run|limited\s+offer|while\s+supplies\s+last|today\s+only)\b/ig;
const RE_DEADLINE_WORD = /\b(ends|ending|until|thru|through|by)\b\s+(?:[a-z]+|\d{1,2}(?:\/\d{1,2}(?:\/\d{2,4})?)?)/ig;
const RE_COUNTDOWN    = /\b(countdown|ends\s+in\s+\d+\s+(?:day|days|hour|hours|week|weeks)|\d+\s+days?\s+(?:left|remaining))\b/ig;

// Absolute dates (US-ish): "Oct 15", "October 15, 2025", "10/15", "10/15/2025"
const RE_MONTH_DAY = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/ig;
const RE_MM_DD     = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;

// Banner-y hints
const RE_BANNER   = /\b(hero|banner|promo|announcement|marquee)\b/i;

/* ----------------------------- date helpers ---------------------------- */

const MONTHS = [
  "january","february","march","april","may","jun","june","jul","july","august",
  "september","sept","october","november","december"
];

function monthToIndex(s: string): number | null {
  const i = MONTHS.indexOf(s.toLowerCase());
  if (i < 0) return null;
  // normalize short forms
  if (s.toLowerCase() === "jun") return 5;
  if (s.toLowerCase() === "jul") return 6;
  return i >= 11 ? 11 : i; // guard
}

function toIsoDate(y: number, mIdx: number, d: number): string | null {
  try {
    const dt = new Date(Date.UTC(y, mIdx, d));
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  } catch { return null; }
}

function parseAbsoluteDates(text: string, now = new Date()): string[] {
  const out = new Set<string>();

  // Month name day [, year]
  let m: RegExpExecArray | null;
  const rx1 = new RegExp(RE_MONTH_DAY.source, "ig");
  while ((m = rx1.exec(text))) {
    const mon = m[1]; const day = Number(m[2]); const yRaw = m[3];
    const mi = monthToIndex(mon);
    if (mi === null || day < 1 || day > 31) continue;
    let y = Number(yRaw);
    if (!Number.isFinite(y)) {
      y = now.getUTCFullYear();
      // if the date already passed this year, assume next year
      const candidate = new Date(Date.UTC(y, mi, day));
      if (candidate.getTime() < now.getTime()) y = y + 1;
    } else if (y < 100) {
      y = 2000 + y;
    }
    const iso = toIsoDate(y, mi, day);
    if (iso) out.add(iso);
  }

  // mm/dd[/yyyy]
  const rx2 = new RegExp(RE_MM_DD.source, "g");
  while ((m = rx2.exec(text))) {
    const mm = Number(m[1]); const dd = Number(m[2]); const yRaw = m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    let y = Number(yRaw);
    if (!Number.isFinite(y)) {
      y = now.getUTCFullYear();
      const candidate = new Date(Date.UTC(y, mm - 1, dd));
      if (candidate.getTime() < now.getTime()) y = y + 1;
    } else if (y < 100) {
      y = 2000 + y;
    }
    const iso = toIsoDate(y, mm - 1, dd);
    if (iso) out.add(iso);
  }

  return Array.from(out).slice(0, 24);
}

function endsInDaysFromText(text: string): number[] {
  const out: number[] = [];
  // ends in X days / X days left
  const rx = /\b(?:ends\s+in\s+(\d+)\s+(day|days|hour|hours|week|weeks)|(\d+)\s+days?\s+(?:left|remaining))\b/ig;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    let n = 0;
    if (m[1]) {
      const v = Number(m[1]);
      const unit = (m[2] || "").toLowerCase();
      if (unit.startsWith("day")) n = v;
      else if (unit.startsWith("hour")) n = v / 24;
      else if (unit.startsWith("week")) n = v * 7;
    } else if (m[3]) {
      n = Number(m[3]);
    }
    if (Number.isFinite(n) && n >= 0) out.push(Math.round(n));
  }
  return out.slice(0, 24);
}

/* ---------------------------- per-page flags --------------------------- */

export function assessPagePromo(page: PromoPage): PromoFlags {
  const html = String(page.html || "");
  const text = safeText(page.html, page.text);
  const blob = (html + "\n" + text);

  const saleHits      = count(RE_SALE, text);
  const clearanceHits = count(RE_CLEAR, text);
  const bogoHits      = count(RE_BOGO, text);
  const couponWords   = count(RE_COUPON, text);
  const freeShipHits  = count(RE_FREESHIP, text);

  const limitedHits   = count(RE_LIMITED, text);
  const deadlinePhrases = count(RE_DEADLINE_WORD, text);
  const countdownHits   = count(RE_COUNTDOWN, text);

  const promoCodes = new Set<string>();
  {
    let m: RegExpExecArray | null;
    const rx = new RegExp(RE_CODE_CAP.source, "g");
    while ((m = rx.exec(text))) {
      // Keep ALL CAPS or mixed; normalize to upper
      const code = (m[1] || "").toUpperCase();
      if (code && /^[A-Z0-9]{4,14}$/.test(code)) promoCodes.add(code);
    }
  }

  // launch / new collection
  const launchHits = count(/\b(launch|introducing|now\s+available|just\s+launched)\b/ig, text);
  const newHits    = count(/\b(new\s+(arrivals?|collection|drop|product)|just\s+dropped)\b/ig, text);

  // dates & "ends in X days"
  const deadlineDates = parseAbsoluteDates(text);
  const endsIn = endsInDaysFromText(text);

  // banner-y hints from HTML class/alt
  const bannerHints =
    count(RE_BANNER, html) +
    count(/\balt=["'][^"']*(sale|promo|deal|coupon)[^"']*["']/ig, html);

  return {
    saleHits,
    clearanceHits,
    bogoHits,
    couponWords,
    promoCodes,
    freeShipHits,
    launchHits,
    newHits,
    deadlineDates,
    deadlinePhrases,
    countdownHits,
    limitedHits,
    bannerHints,
    endsInDaysMentions: endsIn,
  };
}

/* ---------------------------- merge & assess --------------------------- */

export function mergePromoFlags(list: PromoFlags[]): PromoFlags {
  const base: PromoFlags = {
    saleHits: 0,
    clearanceHits: 0,
    bogoHits: 0,
    couponWords: 0,
    promoCodes: new Set<string>(),
    freeShipHits: 0,
    launchHits: 0,
    newHits: 0,
    deadlineDates: [],
    deadlinePhrases: 0,
    countdownHits: 0,
    limitedHits: 0,
    bannerHints: 0,
    endsInDaysMentions: [],
  };
  for (const f of list) {
    base.saleHits += f.saleHits;
    base.clearanceHits += f.clearanceHits;
    base.bogoHits += f.bogoHits;
    base.couponWords += f.couponWords;
    f.promoCodes.forEach((c) => base.promoCodes.add(c));
    base.freeShipHits += f.freeShipHits;
    base.launchHits += f.launchHits;
    base.newHits += f.newHits;
    base.deadlineDates.push(...f.deadlineDates);
    base.deadlinePhrases += f.deadlinePhrases;
    base.countdownHits += f.countdownHits;
    base.limitedHits += f.limitedHits;
    base.bannerHints += f.bannerHints;
    base.endsInDaysMentions.push(...f.endsInDaysMentions);
  }
  // de-dup dates
  base.deadlineDates = Array.from(new Set(base.deadlineDates)).slice(0, 50);
  // trim endsIn mentions
  base.endsInDaysMentions = base.endsInDaysMentions.slice(0, 50);
  return base;
}

export function assessPromo(pages: PromoPage[], now = new Date()): PromoSignal {
  const per = (Array.isArray(pages) ? pages : []).map(assessPagePromo);
  const flags = mergePromoFlags(per);

  // Compute earliest endsInDays based on relative or absolute dates
  let endsInDays: number | null = null;

  // From "ends in X days"
  if (flags.endsInDaysMentions.length) {
    endsInDays = flags.endsInDaysMentions.reduce((a, b) => Math.min(a, b), Infinity);
    if (!Number.isFinite(endsInDays)) endsInDays = null;
  }

  // From absolute deadlines
  for (const iso of flags.deadlineDates) {
    const d = new Date(iso + "T23:59:59Z");
    const diff = Math.round((d.getTime() - now.getTime()) / (24 * 3600 * 1000));
    if (Number.isFinite(diff)) {
      endsInDays = endsInDays == null ? diff : Math.min(endsInDays, diff);
    }
  }

  // Confidence scoring
  let score = 0;
  const reasons: string[] = [];

  const add = (pts: number, why: string, present: boolean) => {
    if (present && pts > 0) { score += pts; reasons.push(why); }
  };

  add(Math.min(24, flags.saleHits * 4),            "sale",              flags.saleHits > 0);
  add(Math.min(15, flags.couponWords * 3),         "coupon",            flags.couponWords > 0);
  add(Math.min(20, flags.promoCodes.size * 5),     "codes",             flags.promoCodes.size > 0);
  add(Math.min(6,  flags.freeShipHits * 3),        "free-ship",         flags.freeShipHits > 0);
  add(Math.min(15, flags.deadlinePhrases * 5),     "deadline-phrases",  flags.deadlinePhrases > 0);
  add(Math.min(12, flags.countdownHits * 6),       "countdown",         flags.countdownHits > 0);
  add(Math.min(8,  flags.limitedHits * 4),         "limited",           flags.limitedHits > 0);
  add(Math.min(6,  flags.bogoHits * 6),            "bogo",              flags.bogoHits > 0);
  add(Math.min(6,  flags.clearanceHits * 6),       "clearance",         flags.clearanceHits > 0);
  add(Math.min(6,  (flags.launchHits + flags.newHits) * 2), "launch/new", (flags.launchHits + flags.newHits) > 0);
  add(Math.min(4,  flags.bannerHints * 2),         "banner",            flags.bannerHints > 0);
  add(Math.min(10, flags.deadlineDates.length * 5),"absolute-deadline", flags.deadlineDates.length > 0);

  // Short fuse bonus if ends soon
  if (endsInDays != null) {
    if (endsInDays <= 1) { score += 14; reasons.push("ends~1d"); }
    else if (endsInDays <= 3) { score += 10; reasons.push("ends~3d"); }
    else if (endsInDays <= 7) { score += 6; reasons.push("ends~7d"); }
    else if (endsInDays <= 14) { score += 3; reasons.push("ends~14d"); }
  }

  score = clamp(score);
  const hasPromo =
    score >= 10 ||
    flags.saleHits > 0 || flags.couponWords > 0 || flags.promoCodes.size > 0 ||
    flags.limitedHits > 0 || flags.deadlinePhrases > 0 || flags.countdownHits > 0;

  // Decorate reasons with specific codes / dates (brief form)
  const codes = Array.from(flags.promoCodes).slice(0, 6);
  for (const c of codes) reasons.push(`code:${c}`);
  for (const d of flags.deadlineDates.slice(0, 4)) reasons.push(`by:${d}`);

  return {
    confidence: score,
    reasons: reasons.slice(0, 12),
    hasPromo,
    promoCodes: codes,
    deadlinesIso: flags.deadlineDates.slice(0, 8),
    endsInDays: Number.isFinite(endsInDays as any) ? (endsInDays as number) : null,
    flags,
  };
}

export function brief(p: PromoSignal): string {
  const bits = [
    p.promoCodes.length ? `codes:${p.promoCodes.length}` : "",
    p.endsInDays != null ? `ends:${p.endsInDays}d` : "",
    p.deadlinesIso.length ? `by:${p.deadlinesIso[0]}` : "",
  ].filter(Boolean).join(", ");
  return `promo ${p.confidence}${bits ? " — " + bits : ""}`;
}

export default {
  assessPromo,
  assessPagePromo,
  mergePromoFlags,
  brief,
};