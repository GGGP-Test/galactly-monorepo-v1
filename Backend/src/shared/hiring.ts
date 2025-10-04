// src/shared/hiring.ts
//
// Hiring / expansion intent detector (no deps, deterministic).
// Feed it a few HTML/text pages (from your spider). It looks for:
//  - Careers/Jobs pages & wording
//  - ATS/job-board platforms (Greenhouse, Lever, Workable, Ashby, etc.)
//  - JSON-LD JobPosting items (counts + recency)
//  - “Posted X days ago”, “Apply now”, salary hints, remote/hybrid hints
//
// Exports:
//   assessHiring(pages) -> HiringSignal (score 0..100 + reasons + flags)
//   assessPageHiring(page) -> HiringFlags      (per page)
//   mergeHiringFlags(list) -> HiringFlags      (aggregate)
//   brief(signal) -> short string for logs
//
// Shape:
//   type HiringPage  = { url: string; html?: string; text?: string }
//   type HiringFlags = { ... } // low-level counts/switches
//   type HiringSignal = {
//     score: number; reasons: string[]; openRolesHint: number;
//     recencyDaysMedian: number|null; platforms: string[]; flags: HiringFlags
//   }

/* eslint-disable @typescript-eslint/no-explicit-any */

export type HiringPage = {
  url: string;
  html?: string;
  text?: string;
};

export type HiringFlags = {
  careersWordHits: number;     // "careers/jobs/we're hiring/join our team"
  applyWordHits: number;       // "apply now", "submit application"
  careersUrlHits: number;      // URL looks like /careers, /jobs, /join-our-team
  hasCareersSurface: boolean;  // overall presence from any of the above

  jobPostingJsonCount: number; // JSON-LD @type: JobPosting items
  recencyDays: number[];       // parsed days-since-posted (JSON-LD or text)

  salaryHits: number;          // "$55,000", "USD", "salary", "pay range"
  remoteHits: number;          // "remote", "hybrid"
  platforms: Set<string>;      // detected ATS domains ("greenhouse","lever",...)

  suggestCareersUrls: string[];// candidates discovered on-page
};

export type HiringSignal = {
  score: number;                // 0..100
  reasons: string[];
  openRolesHint: number;        // estimated # openings
  recencyDaysMedian: number | null;
  platforms: string[];
  flags: HiringFlags;
};

const lc = (s: any) => String(s ?? "").toLowerCase();
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

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

/* ------------------------------- regexes ------------------------------ */

const RE_CAREERS_WORDS = /\b(careers?|jobs?|open positions?|we'?re\s+hiring|now\s+hiring|join\s+our\s+team)\b/i;
const RE_APPLY = /\b(apply\s+now|submit\s+application|apply\s+today|apply)\b/i;

const RE_CAREERS_URL = /(\/careers(\/|$)|\/jobs(\/|$)|\/join-our-team(\/|$)|\/joinus(\/|$))/i;

const RE_ATS = /(boards\.greenhouse\.io|greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|bamboohr\.com|icims\.com|taleo\.net|workday|smartrecruiters\.com|jazzhr\.com|recruitee\.com|jobvite\.com|linkedin\.com\/jobs)/i;

const RE_SALARY =
  /(\$|usd|salary|compensation|pay\s*range|\$\d{2,3}(?:,\d{3})?)(?!\s*per)/i;

const RE_REMOTE = /\b(remote|hybrid)\b/i;

const RE_POSTED_DAYS = /\bposted\s+(\d{1,3})\s+days?\s+ago\b/i;

const RE_JSONLD_SCRIPT = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/* ------------------------- JSON-LD JobPosting ------------------------- */

function extractJobPostingFromHtml(html?: string): { count: number; days: number[] } {
  if (!html) return { count: 0, days: [] };
  const days: number[] = [];
  let count = 0;

  const scripts = html.match(RE_JSONLD_SCRIPT) || [];
  for (const s of scripts) {
    const body = (s.match(/>([\s\S]*?)<\/script>/i)?.[1] || "").trim();
    try {
      const j = JSON.parse(body);
      const items = flattenGraph(j);
      for (const it of items) {
        if (isJobPosting(it)) {
          count++;
          const d = postedDays(it);
          if (d !== null) days.push(d);
        }
      }
    } catch {
      // ignore invalid JSON-LD blobs
    }
  }
  return { count: Math.min(count, 2000), days: days.slice(0, 200) };
}

function flattenGraph(x: any): any[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.flatMap(flattenGraph);
  const g = (x as any)['@graph'];
  return g ? flattenGraph(g) : [x];
}

function isJobPosting(obj: any): boolean {
  const t = obj?.['@type'];
  if (!t) return false;
  if (typeof t === 'string') return /jobposting/i.test(t);
  if (Array.isArray(t)) return t.some((v) => typeof v === 'string' && /jobposting/i.test(v));
  return false;
}

function postedDays(obj: any): number | null {
  const iso = obj?.datePosted || obj?.validThrough || obj?.datePublished;
  if (typeof iso === 'string') {
    const ts = Date.parse(iso);
    if (Number.isFinite(ts)) {
      const diffMs = Date.now() - ts;
      const d = Math.floor(diffMs / (24 * 3600 * 1000));
      if (d >= 0 && d <= 730) return d;
    }
  }
  return null;
}

/* ----------------------------- page assess ---------------------------- */

export function assessPageHiring(page: HiringPage): HiringFlags {
  const url = lc(page.url || "");
  const html = String(page.html || "");
  const text = safeText(page.html, page.text);
  const blob = html + "\n" + text;

  const careersWordHits = countMatches(RE_CAREERS_WORDS, blob);
  const applyWordHits = countMatches(RE_APPLY, blob);
  const careersUrlHits = RE_CAREERS_URL.test(url) ? 1 : 0;

  const atses = detectPlatforms(blob);
  const { count: jobPostingJsonCount, days } = extractJobPostingFromHtml(html);

  const salaryHits = countMatches(RE_SALARY, blob);
  const remoteHits = countMatches(RE_REMOTE, blob);

  const suggestCareersUrls = discoverCareersUrls(html);

  const hasCareersSurface =
    careersWordHits > 0 || applyWordHits > 0 || careersUrlHits > 0 || atses.size > 0 || jobPostingJsonCount > 0;

  return {
    careersWordHits,
    applyWordHits,
    careersUrlHits,
    hasCareersSurface,
    jobPostingJsonCount,
    recencyDays: days,
    salaryHits,
    remoteHits,
    platforms: atses,
    suggestCareersUrls,
  };
}

function countMatches(re: RegExp, s: string): number {
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const m = s.match(rx);
  return m ? Math.min(m.length, 200) : 0;
}

function detectPlatforms(s: string): Set<string> {
  const atses = new Set<string>();
  const rx = new RegExp(RE_ATS.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s))) {
    const host = String(m[1] || m[0]).toLowerCase();
    if (host.includes("greenhouse")) atses.add("greenhouse");
    else if (host.includes("lever")) atses.add("lever");
    else if (host.includes("workable")) atses.add("workable");
    else if (host.includes("ashby")) atses.add("ashby");
    else if (host.includes("bamboohr")) atses.add("bamboohr");
    else if (host.includes("icims")) atses.add("icims");
    else if (host.includes("taleo")) atses.add("taleo");
    else if (host.includes("workday")) atses.add("workday");
    else if (host.includes("smartrecruiters")) atses.add("smartrecruiters");
    else if (host.includes("jazzhr")) atses.add("jazzhr");
    else if (host.includes("recruitee")) atses.add("recruitee");
    else if (host.includes("jobvite")) atses.add("jobvite");
    else if (host.includes("linkedin")) atses.add("linkedin");
  }
  return atses;
}

function discoverCareersUrls(html: string): string[] {
  const out = new Set<string>();
  const aTags = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi) || [];
  for (const a of aTags) {
    const href = (a.match(/href=["']([^"']+)["']/i)?.[1] || "").trim();
    const txt = (a.match(/>([\s\S]*?)<\/a>/i)?.[1] || "").toLowerCase();
    if (!href) continue;
    if (RE_CAREERS_URL.test(href) || RE_CAREERS_WORDS.test(txt) || /apply/i.test(txt)) {
      out.add(href);
    }
  }
  return Array.from(out).slice(0, 20);
}

/* ---------------------------- merge & score ---------------------------- */

export function mergeHiringFlags(list: HiringFlags[]): HiringFlags {
  const base: HiringFlags = {
    careersWordHits: 0,
    applyWordHits: 0,
    careersUrlHits: 0,
    hasCareersSurface: false,
    jobPostingJsonCount: 0,
    recencyDays: [],
    salaryHits: 0,
    remoteHits: 0,
    platforms: new Set<string>(),
    suggestCareersUrls: [],
  };
  for (const f of list) {
    base.careersWordHits += f.careersWordHits;
    base.applyWordHits += f.applyWordHits;
    base.careersUrlHits += f.careersUrlHits;
    base.hasCareersSurface ||= f.hasCareersSurface;

    base.jobPostingJsonCount += f.jobPostingJsonCount;
    base.salaryHits += f.salaryHits;
    base.remoteHits += f.remoteHits;

    f.recencyDays.forEach((d) => { if (Number.isFinite(d)) base.recencyDays.push(d); });
    f.platforms.forEach((p) => base.platforms.add(p));

    base.suggestCareersUrls.push(...f.suggestCareersUrls);
  }
  // tidy caps
  base.careersWordHits = Math.min(base.careersWordHits, 1000);
  base.applyWordHits = Math.min(base.applyWordHits, 1000);
  base.careersUrlHits = Math.min(base.careersUrlHits, 50);
  base.jobPostingJsonCount = Math.min(base.jobPostingJsonCount, 5000);
  base.recencyDays = base.recencyDays.slice(0, 500);
  base.salaryHits = Math.min(base.salaryHits, 200);
  base.remoteHits = Math.min(base.remoteHits, 200);
  base.suggestCareersUrls = Array.from(new Set(base.suggestCareersUrls)).slice(0, 50);
  return base;
}

function median(nums: number[]): number | null {
  const a = nums.slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function rolesPoints(n: number): number {
  if (n >= 50) return 24;
  if (n >= 10) return 18;
  if (n >= 3)  return 12;
  if (n >= 1)  return 7;
  return 0;
}

export function assessHiring(pages: HiringPage[]): HiringSignal {
  const per = (Array.isArray(pages) ? pages : []).map(assessPageHiring);
  const flags = mergeHiringFlags(per);

  const recencyMed = median(flags.recencyDays);
  // Heuristic for open roles: prefer JSON-LD count; if none, use word/URL signals
  const openRolesHint =
    flags.jobPostingJsonCount > 0
      ? flags.jobPostingJsonCount
      : Math.min(5, Math.floor(flags.careersWordHits / 3) + flags.careersUrlHits);

  let score = 0;
  const reasons: string[] = [];

  if (flags.hasCareersSurface) { score += 8; reasons.push("careers-surface"); }
  if (flags.platforms.size)     { score += 6; reasons.push(`ats:${Array.from(flags.platforms).slice(0,3).join(",")}`); }

  const rpts = rolesPoints(openRolesHint);
  if (rpts) { score += rpts; reasons.push(`roles~${openRolesHint}`); }

  if (typeof recencyMed === "number") {
    if (recencyMed <= 14) { score += 10; reasons.push(`fresh≤14d`); }
    else if (recencyMed <= 30) { score += 6; reasons.push(`fresh≤30d`); }
    else if (recencyMed <= 90) { score += 3; reasons.push(`fresh≤90d`); }
  }

  if (flags.salaryHits) { score += Math.min(3, 1 + Math.floor(flags.salaryHits / 5)); reasons.push("salary-listed"); }
  if (flags.remoteHits) { score += Math.min(2, 1 + Math.floor(flags.remoteHits / 10)); reasons.push("remote/hybrid"); }

  // If *only* a tiny mention but no platforms/postings, give a tiny nudge, not a big boost
  if (score === 0 && (flags.careersWordHits || flags.applyWordHits)) {
    score += 3;
    reasons.push("hiring-mention");
  }

  score = clamp(score);

  return {
    score,
    reasons: reasons.slice(0, 12),
    openRolesHint: Math.max(0, openRolesHint),
    recencyDaysMedian: recencyMed ?? null,
    platforms: Array.from(flags.platforms).sort(),
    flags,
  };
}

/** Short log line */
export function brief(h: HiringSignal): string {
  const bits = [
    h.openRolesHint ? `roles~${h.openRolesHint}` : "",
    (typeof h.recencyDaysMedian === "number") ? `med~${h.recencyDaysMedian}d` : "",
    h.platforms.length ? `ats:${h.platforms.slice(0,2).join(",")}` : "",
  ].filter(Boolean);
  return `hiring ${h.score} — ${bits.join(", ") || "none"}`;
}

export default {
  assessHiring,
  assessPageHiring,
  mergeHiringFlags,
  brief,
};