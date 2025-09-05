// src/leadgen/dedupe-index.ts
import { createHash } from "crypto";

export interface LeadLike {
  id?: string;
  company?: string;
  domain?: string; // e.g., "acme.com"
  website?: string; // e.g., "https://www.acme.com/about"
  emails?: string[];
  phones?: string[];
  address?: string; // free text
  country?: string;
}

export interface MatchResult {
  matched: boolean;
  leadId?: string;
  score: number; // 0..1
  reasons: string[];
}

export interface DedupeIndexSnapshot {
  version: number;
  items: Record<string, LeadLike>;
  keys: {
    byDomain: Record<string, string[]>; // domain -> leadIds
    byEmail: Record<string, string[]>; // emailHash -> leadIds
    byPhone: Record<string, string[]>; // e164 -> leadIds
    byCompany: Record<string, string[]>; // canonical name -> leadIds
    byURL: Record<string, string[]>; // normalized URL -> leadIds
  };
}

function normDomain(d?: string) {
  if (!d) return "";
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function normURL(u?: string) {
  if (!u) return "";
  try {
    const url = new URL(u);
    url.hash = "";
    // strip utm params and tracking
    const toDelete = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
    toDelete.forEach((p) => url.searchParams.delete(p));
    const s = url.toString();
    return s.endsWith("/") ? s.slice(0, -1) : s;
  } catch {
    // try to coerce as domain
    return "https://" + normDomain(u);
  }
}

const STOP_WORDS = new Set([
  "inc",
  "llc",
  "ltd",
  "co",
  "corp",
  "corporation",
  "company",
  "packaging",
  "pack",
  "solutions",
  "the",
  "&",
]);

function canonicalCompanyName(name?: string) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t))
    .join(" ");
}

function emailHash(e: string) {
  return createHash("sha1").update(e.trim().toLowerCase()).digest("hex");
}

function normPhone(p?: string) {
  if (!p) return "";
  // naive E.164-ish: keep digits, add '+' if country code present
  const digits = p.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("1") && digits.length === 11) return "+" + digits;
  if (digits.length === 10) return "+1" + digits; // default to US
  return "+" + digits;
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = new Set([...a].filter((x) => b.has(x)));
  return inter.size / (a.size + b.size - inter.size);
}

export class DedupeIndex {
  private items = new Map<string, LeadLike>();
  private byDomain = new Map<string, Set<string>>();
  private byEmail = new Map<string, Set<string>>();
  private byPhone = new Map<string, Set<string>>();
  private byCompany = new Map<string, Set<string>>();
  private byURL = new Map<string, Set<string>>();

  constructor(snapshot?: DedupeIndexSnapshot) {
    if (snapshot) this.load(snapshot);
  }

  size() {
    return this.items.size;
  }

  add(lead: LeadLike): { id: string; match?: MatchResult } {
    const id = lead.id || this.genId();
    const normalized: LeadLike = {
      ...lead,
      id,
      domain: lead.domain || (lead.website ? new URL(normURL(lead.website)).hostname : undefined),
    };

    // try match before insert
    const match = this.findMatch(normalized);

    // insert indexes
    this.items.set(id, normalized);
    const domain = normDomain(normalized.domain);
    if (domain) this.idx(this.byDomain, domain, id);
    const url = normURL(normalized.website);
    if (url) this.idx(this.byURL, url, id);
    (normalized.emails || []).forEach((e) => this.idx(this.byEmail, emailHash(e), id));
    (normalized.phones || []).forEach((p) => this.idx(this.byPhone, normPhone(p), id));
    const cname = canonicalCompanyName(normalized.company);
    if (cname) this.idx(this.byCompany, cname, id);

    return { id, match };
  }

  upsert(lead: LeadLike): { id: string; created: boolean } {
    const found = this.findMatch(lead, 0.92); // stricter for upsert
    if (found.matched && found.leadId) {
      const existing = this.items.get(found.leadId)!;
      const merged: LeadLike = {
        ...existing,
        ...lead,
        id: found.leadId,
        emails: Array.from(new Set([...(existing.emails || []), ...(lead.emails || [])])),
        phones: Array.from(new Set([...(existing.phones || []), ...(lead.phones || [])])),
      };
      this.remove(found.leadId);
      this.add(merged);
      return { id: found.leadId, created: false };
    }
    return { id: this.add(lead).id, created: true };
  }

  remove(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    const domain = normDomain(item.domain);
    if (domain) this.unidx(this.byDomain, domain, id);
    const url = normURL(item.website);
    if (url) this.unidx(this.byURL, url, id);
    (item.emails || []).forEach((e) => this.unidx(this.byEmail, emailHash(e), id));
    (item.phones || []).forEach((p) => this.unidx(this.byPhone, normPhone(p), id));
    const cname = canonicalCompanyName(item.company);
    if (cname) this.unidx(this.byCompany, cname, id);
  }

  findMatch(candidate: LeadLike, threshold = 0.8): MatchResult {
    const reasons: string[] = [];
    const domain = normDomain(candidate.domain || (candidate.website ? new URL(normURL(candidate.website)).hostname : ""));
    const cname = canonicalCompanyName(candidate.company);
    const url = normURL(candidate.website);
    const emails = (candidate.emails || []).map(emailHash);
    const phones = (candidate.phones || []).map(normPhone);

    const candidates = new Set<string>();

    if (domain && this.byDomain.has(domain)) this.byDomain.get(domain)!.forEach((id) => candidates.add(id));
    if (url && this.byURL.has(url)) this.byURL.get(url)!.forEach((id) => candidates.add(id));
    emails.forEach((e) => this.byEmail.get(e)?.forEach((id) => candidates.add(id)));
    phones.forEach((p) => this.byPhone.get(p)?.forEach((id) => candidates.add(id)));
    if (cname && this.byCompany.has(cname)) this.byCompany.get(cname)!.forEach((id) => candidates.add(id));

    let best: { id: string; score: number; reasons: string[] } | undefined;

    for (const id of candidates) {
      const item = this.items.get(id)!;
      const s = this.similarity(candidate, item);
      if (!best || s.score > best.score) best = { id, ...s };
    }

    if (best && best.score >= threshold) {
      return { matched: true, leadId: best.id, score: best.score, reasons: best.reasons };
    }
    return { matched: false, score: best?.score || 0, reasons: best?.reasons || reasons };
  }

  private similarity(a: LeadLike, b: LeadLike): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Domain exact
    const ad = normDomain(a.domain || (a.website ? new URL(normURL(a.website)).hostname : ""));
    const bd = normDomain(b.domain || (b.website ? new URL(normURL(b.website)).hostname : ""));
    if (ad && bd && ad === bd) {
      score += 0.45;
      reasons.push("domain:exact");
    }

    // URL exact
    const au = normURL(a.website);
    const bu = normURL(b.website);
    if (au && bu && au === bu) {
      score += 0.2;
      reasons.push("url:exact");
    }

    // Email any exact (hashed)
    const aEmails = new Set((a.emails || []).map(emailHash));
    const bEmails = new Set((b.emails || []).map(emailHash));
    const eJacc = jaccard(aEmails, bEmails);
    if (eJacc > 0) {
      score += Math.min(0.3, eJacc * 0.3);
      reasons.push("email:overlap");
    }

    // Phone any exact
    const aPhones = new Set((a.phones || []).map(normPhone));
    const bPhones = new Set((b.phones || []).map(normPhone));
    const pJacc = jaccard(aPhones, bPhones);
    if (pJacc > 0) {
      score += Math.min(0.25, pJacc * 0.25);
      reasons.push("phone:overlap");
    }

    // Company canonical similarity via token Jaccard
    const aTokens = new Set(canonicalCompanyName(a.company).split(/\s+/).filter(Boolean));
    const bTokens = new Set(canonicalCompanyName(b.company).split(/\s+/).filter(Boolean));
    const cJacc = jaccard(aTokens, bTokens);
    if (cJacc > 0) {
      score += Math.min(0.25, cJacc * 0.25);
      reasons.push("company:similar");
    }

    // Address country hint (very weak)
    if (a.country && b.country && a.country.toLowerCase() === b.country.toLowerCase()) {
      score += 0.05;
      reasons.push("country:match");
    }

    return { score: Math.min(1, score), reasons };
  }

  private idx(map: Map<string, Set<string>>, key: string, id: string) {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
  }

  private unidx(map: Map<string, Set<string>>, key: string, id: string) {
    const set = map.get(key);
    if (!set) return;
    set.delete(id);
    if (set.size === 0) map.delete(key);
  }

  toJSON(): DedupeIndexSnapshot {
    const items: Record<string, LeadLike> = {};
    for (const [k, v] of this.items) items[k] = v;
    const keys = {
      byDomain: Object.fromEntries([...this.byDomain].map(([k, v]) => [k, [...v]])),
      byEmail: Object.fromEntries([...this.byEmail].map(([k, v]) => [k, [...v]])),
      byPhone: Object.fromEntries([...this.byPhone].map(([k, v]) => [k, [...v]])),
      byCompany: Object.fromEntries([...this.byCompany].map(([k, v]) => [k, [...v]])),
      byURL: Object.fromEntries([...this.byURL].map(([k, v]) => [k, [...v]])),
    };
    return { version: 1, items, keys };
  }

  load(s: DedupeIndexSnapshot) {
    this.items = new Map(Object.entries(s.items));
    this.byDomain = new Map(Object.entries(s.keys.byDomain).map(([k, arr]) => [k, new Set(arr)]));
    this.byEmail = new Map(Object.entries(s.keys.byEmail).map(([k, arr]) => [k, new Set(arr)]));
    this.byPhone = new Map(Object.entries(s.keys.byPhone).map(([k, arr]) => [k, new Set(arr)]));
    this.byCompany = new Map(Object.entries(s.keys.byCompany).map(([k, arr]) => [k, new Set(arr)]));
    this.byURL = new Map(Object.entries(s.keys.byURL).map(([k, arr]) => [k, new Set(arr)]));
  }

  private genId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// Convenience singleton if you want a process-wide index
export const globalDedupeIndex = new DedupeIndex();
