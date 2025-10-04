// src/shared/specs.ts
//
// Specs / datasheets / price-list detector (deterministic; zero deps).
// Finds signs of technical documents & downloads: specs, datasheets,
// price lists, catalogs, SDS/MSDS, cut sheets, dielines, CAD/drawings.
//
// Exports:
//   assessSpecs(pages) -> SpecSignal
//   assessPageSpecs(page) -> SpecFlags
//   mergeSpecFlags(list) -> SpecFlags
//   brief(signal) -> string
//
// Shapes:
//   type SpecPage = { url: string; html?: string; text?: string }
//   type SpecFlags = {... counters & captured values ...}
//   type SpecSignal = {
//     confidence: number; reasons: string[]; hasSpecs: boolean;
//     fileUrls: string[]; fileCount: number; flags: SpecFlags
//   }

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SpecPage = { url: string; html?: string; text?: string };

export type SpecFlags = {
  specHits: number;        // "spec", "specs", "specification"
  datasheetHits: number;   // "datasheet", "data sheet", "sell sheet"
  priceListHits: number;   // "price list", "pricing sheet"
  catalogHits: number;     // "catalog", "catalogue", "brochure"
  sdsHits: number;         // "SDS", "MSDS", "safety data sheet"
  cutSheetHits: number;    // "cut sheet", "sell sheet"
  dielineHits: number;     // "dieline", "die line", "artwork template"
  cadHits: number;         // "CAD", "drawing", "engineering drawing"
  techHits: number;        // "technical", "dimensions", "spec table"
  downloadHints: number;   // "download", "PDF", "printable"
  fileUrls: string[];      // captured links to pdf/doc/xls etc.
  fileNames: string[];     // anchor texts that look like docs
};

export type SpecSignal = {
  confidence: number;     // 0..100
  reasons: string[];
  hasSpecs: boolean;
  fileUrls: string[];     // top few canonicalized
  fileCount: number;      // total (deduped) captured files
  flags: SpecFlags;
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

const RE_SPEC        = /\b(spec(?:s|ification|ifications)?)\b/ig;
const RE_DATASHEET   = /\b(data\s*sheet|datasheet|sell\s*sheet|tech\s*sheet)\b/ig;
const RE_PRICELIST   = /\b(price\s*list|pricing\s*(?:sheet|guide)|wholesale\s*price)\b/ig;
const RE_CATALOG     = /\b(catalogue?|brochure|line\s*card)\b/ig;
const RE_SDS         = /\b((?:m?\s*sds|safety\s*data\s*sheet|material\s*safety\s*data\s*sheet))\b/ig;
const RE_CUTSHEET    = /\b(cut\s*sheet|cut-sheet|sell\s*sheet)\b/ig;
const RE_DIELINE     = /\b(die\s*line|dieline|artwork\s*template|label\s*template)\b/ig;
const RE_CAD         = /\b(CAD|dwg|engineering\s*drawing|technical\s*drawing)\b/ig;
const RE_TECH        = /\b(technical|dimensions?|size\s*chart|case\s*pack|spec\s*table|sku\s*list)\b/ig;
const RE_DOWNLOAD    = /\b(download|pdf|printable)\b/ig;

// very light <a> extractor (href + inner text)
const RE_LINK = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/ig;

// file-like endings or query hints
const RE_FILE_END = /\.(?:pdf|csv|xls|xlsx|doc|docx|ppt|pptx)\b/i;
const RE_FILE_Q   = /\b(file|download|doc|datasheet|spec)\b/i;

/* ---------------------------- per-page flags --------------------------- */

export function assessPageSpecs(page: SpecPage): SpecFlags {
  const html = String(page.html || "");
  const text = safeText(page.html, page.text);

  const fileSet = new Set<string>();
  const nameSet = new Set<string>();

  // scan links for likely files
  let m: RegExpExecArray | null;
  const rx = new RegExp(RE_LINK.source, "ig");
  while ((m = rx.exec(html))) {
    const href = (m[1] || "").trim();
    const label = String(m[2] || "").replace(/<[^>]+>/g, " ").trim();
    const isFile = RE_FILE_END.test(href) || RE_FILE_Q.test(href) || RE_FILE_END.test(label);
    if (!isFile) continue;

    // normalize to absolute-ish if already absolute; otherwise keep as-is
    try {
      const u = new URL(href, page.url || "https://example.com/");
      const clean = u.toString();
      fileSet.add(clean);
    } catch {
      fileSet.add(href);
    }

    const labLc = label.toLowerCase();
    if (labLc) nameSet.add(labLc.slice(0, 80));
  }

  const flags: SpecFlags = {
    specHits:        count(RE_SPEC, text),
    datasheetHits:   count(RE_DATASHEET, text),
    priceListHits:   count(RE_PRICELIST, text),
    catalogHits:     count(RE_CATALOG, text),
    sdsHits:         count(RE_SDS, text),
    cutSheetHits:    count(RE_CUTSHEET, text),
    dielineHits:     count(RE_DIELINE, text),
    cadHits:         count(RE_CAD, text),
    techHits:        count(RE_TECH, text),
    downloadHints:   count(RE_DOWNLOAD, text) + count(RE_DOWNLOAD, html),
    fileUrls:        Array.from(fileSet).slice(0, 50),
    fileNames:       Array.from(nameSet).slice(0, 50),
  };

  return flags;
}

/* ---------------------------- merge & assess --------------------------- */

export function mergeSpecFlags(list: SpecFlags[]): SpecFlags {
  const base: SpecFlags = {
    specHits: 0,
    datasheetHits: 0,
    priceListHits: 0,
    catalogHits: 0,
    sdsHits: 0,
    cutSheetHits: 0,
    dielineHits: 0,
    cadHits: 0,
    techHits: 0,
    downloadHints: 0,
    fileUrls: [],
    fileNames: [],
  };
  for (const f of list) {
    base.specHits        += f.specHits;
    base.datasheetHits   += f.datasheetHits;
    base.priceListHits   += f.priceListHits;
    base.catalogHits     += f.catalogHits;
    base.sdsHits         += f.sdsHits;
    base.cutSheetHits    += f.cutSheetHits;
    base.dielineHits     += f.dielineHits;
    base.cadHits         += f.cadHits;
    base.techHits        += f.techHits;
    base.downloadHints   += f.downloadHints;
    base.fileUrls.push(...f.fileUrls);
    base.fileNames.push(...f.fileNames);
  }
  // de-dup + trim files
  base.fileUrls   = Array.from(new Set(base.fileUrls)).slice(0, 100);
  base.fileNames  = Array.from(new Set(base.fileNames)).slice(0, 100);
  return base;
}

export function assessSpecs(pages: SpecPage[]): SpecSignal {
  const per = (Array.isArray(pages) ? pages : []).map(assessPageSpecs);
  const flags = mergeSpecFlags(per);

  // scoring
  let score = 0;
  const reasons: string[] = [];

  const add = (pts: number, why: string, present: boolean) => {
    if (present && pts > 0) { score += pts; reasons.push(why); }
  };

  add(Math.min(16, flags.specHits * 2),          "specs",      flags.specHits > 0);
  add(Math.min(16, flags.datasheetHits * 2),     "datasheet",  flags.datasheetHits > 0);
  add(Math.min(12, flags.priceListHits * 3),     "price-list", flags.priceListHits > 0);
  add(Math.min(12, flags.catalogHits * 2),       "catalog",    flags.catalogHits > 0);
  add(Math.min(12, flags.sdsHits * 3),           "sds",        flags.sdsHits > 0);
  add(Math.min(10, flags.cutSheetHits * 2),      "cut-sheet",  flags.cutSheetHits > 0);
  add(Math.min(10, flags.dielineHits * 2),       "dieline",    flags.dielineHits > 0);
  add(Math.min(8,  flags.cadHits * 2),           "cad",        flags.cadHits > 0);
  add(Math.min(8,  flags.techHits * 2),          "technical",  flags.techHits > 0);
  add(Math.min(8,  flags.downloadHints * 1),     "download",   flags.downloadHints > 0);

  // strong evidence when actual files discovered
  const fileCount = flags.fileUrls.length;
  if (fileCount >= 1)  { score += 15; reasons.push("files>=1"); }
  if (fileCount >= 4)  { score += 10; reasons.push("files>=4"); }
  if (fileCount >= 10) { score += 6;  reasons.push("files>=10"); }

  score = clamp(score);
  const hasSpecs =
    score >= 12 ||
    fileCount > 0 ||
    flags.specHits + flags.datasheetHits + flags.priceListHits + flags.catalogHits > 0;

  // Decorate reasons with a couple file name hints
  for (const nm of flags.fileNames.slice(0, 3)) reasons.push(`file:${nm.slice(0, 24)}`);

  return {
    confidence: score,
    reasons: reasons.slice(0, 12),
    hasSpecs,
    fileUrls: flags.fileUrls.slice(0, 12),
    fileCount,
    flags,
  };
}

export function brief(s: SpecSignal): string {
  const bits = [
    s.fileCount ? `files:${s.fileCount}` : "",
    s.flags.priceListHits ? "price-list" : "",
    s.flags.sdsHits ? "sds" : "",
  ].filter(Boolean).join(", ");
  return `specs ${s.confidence}${bits ? " — " + bits : ""}`;
}

export default {
  assessSpecs,
  assessPageSpecs,
  mergeSpecFlags,
  brief,
};