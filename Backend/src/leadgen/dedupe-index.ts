// src/leadgen/dedupe-index.ts
/**
 * Fuzzy de-duplication for leads by domain, email, and company name.
 * - Primary keys: normalized domain + emails (exact)
 * - Secondary: fuzzy match on company name with Jaro-Winkler similarity
 */

export interface LeadKey {
  id?: string;                 // if known, we can upsert
  companyName: string;
  domain?: string | null;
  emails?: string[];           // any emails tied to the org
}

export interface MatchResult {
  id: string;
  matched: boolean;            // true if matched existing, false if inserted new
  matchKind: "email" | "domain" | "name" | "none";
  similarity?: number;
}

type Stored = Required<LeadKey> & { id: string; created: number; updated: number };

function normalizeDomain(d?: string | null) {
  if (!d) return undefined;
  let s = d.trim().toLowerCase();
  if (s.startsWith("http")) {
    try { s = new URL(s).hostname; } catch {}
  }
  s = s.replace(/^www\./, "");
  return s || undefined;
}

function normalizeEmail(e: string) {
  return e.trim().toLowerCase();
}

function normalizeName(n: string) {
  return n.trim().toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaro-Winkler similarity (0..1) */
function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const m = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const matches1: boolean[] = new Array(s1.length).fill(false);
  const matches2: boolean[] = new Array(s2.length).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - m);
    const end = Math.min(i + m + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (matches2[j]) continue;
      if (s1[i] === s2[j]) {
        matches1[i] = true;
        matches2[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!matches1[i]) continue;
    while (!matches2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  let l = 0;
  while (l < 4 && s1[l] === s2[l]) l++;
  const p = 0.1;
  return jaro + l * p * (1 - jaro);
}

export interface DedupeIndexInit {
  nameMatchThreshold?: number; // default 0.92
}

export class DedupeIndex {
  private byId = new Map<string, Stored>();
  private byDomain = new Map<string, string>(); // domain -> id
  private byEmail = new Map<string, string>();  // email -> id
  private nameIndex = new Map<string, Set<string>>(); // first letter -> candidate ids

  private nameThreshold: number;

  constructor(init: DedupeIndexInit = {}) {
    this.nameThreshold = init.nameMatchThreshold ?? 0.92;
  }

  private newId() {
    return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
  }

  private upsertIndexes(st: Stored) {
    const d = normalizeDomain(st.domain);
    if (d) this.byDomain.set(d, st.id);
    for (const e of st.emails) this.byEmail.set(normalizeEmail(e), st.id);
    const key = (normalizeName(st.companyName)[0] || "#");
    const set = this.nameIndex.get(key) || new Set<string>();
    set.add(st.id);
    this.nameIndex.set(key, set);
  }

  private removeFromIndexes(st: Stored) {
    const d = normalizeDomain(st.domain);
    if (d && this.byDomain.get(d) === st.id) this.byDomain.delete(d);
    for (const e of st.emails) if (this.byEmail.get(normalizeEmail(e)) === st.id) this.byEmail.delete(normalizeEmail(e));
    const key = (normalizeName(st.companyName)[0] || "#");
    const set = this.nameIndex.get(key);
    if (set) set.delete(st.id);
  }

  private findByName(name: string): { id: string; sim: number } | undefined {
    const norm = normalizeName(name);
    const bucket = this.nameIndex.get(norm[0] || "#");
    if (!bucket || bucket.size === 0) return undefined;
    let best: { id: string; sim: number } | undefined;
    for (const id of bucket) {
      const cand = this.byId.get(id);
      if (!cand) continue;
      const sim = jaroWinkler(norm, normalizeName(cand.companyName));
      if (!best || sim > best.sim) best = { id, sim };
    }
    if (best && best.sim >= this.nameThreshold) return best;
    return undefined;
  }

  /** Add a record if not present; otherwise return the matching existing id. */
  addOrMatch(input: LeadKey): MatchResult {
    const domain = normalizeDomain(input.domain || undefined);
    const emails = (input.emails || []).map(normalizeEmail).filter(Boolean);
    const name = input.companyName || "";

    // 1) email exact
    for (const e of emails) {
      const id = this.byEmail.get(e);
      if (id) return { id, matched: true, matchKind: "email" };
    }
    // 2) domain exact
    if (domain) {
      const id = this.byDomain.get(domain);
      if (id) return { id, matched: true, matchKind: "domain" };
    }
    // 3) name fuzzy
    const fuzzy = this.findByName(name);
    if (fuzzy) {
      return { id: fuzzy.id, matched: true, matchKind: "name", similarity: fuzzy.sim };
    }

    // Insert new
    const id = input.id || this.newId();
    const now = Date.now();
    const st: Stored = {
      id,
      companyName: name,
      domain: domain || "",
      emails,
      created: now,
      updated: now,
    };
    this.byId.set(id, st);
    this.upsertIndexes(st);
    return { id, matched: false, matchKind: "none" };
  }

  /** Update an existing record (merging fields) and refresh indexes. */
  update(id: string, patch: Partial<LeadKey>) {
    const cur = this.byId.get(id);
    if (!cur) throw new Error(`unknown id ${id}`);
    this.removeFromIndexes(cur);
    if (patch.companyName) cur.companyName = patch.companyName;
    if (typeof patch.domain !== "undefined") cur.domain = normalizeDomain(patch.domain || "") || "";
    if (patch.emails?.length) {
      const merged = new Set([...cur.emails, ...patch.emails.map(normalizeEmail)]);
      cur.emails = Array.from(merged);
    }
    cur.updated = Date.now();
    this.byId.set(id, cur);
    this.upsertIndexes(cur);
  }

  get(id: string): Stored | undefined { return this.byId.get(id); }

  /** For debugging / analytics. */
  stats() {
    return {
      count: this.byId.size,
      domains: this.byDomain.size,
      emails: this.byEmail.size,
      nameBuckets: this.nameIndex.size,
    };
  }
}
