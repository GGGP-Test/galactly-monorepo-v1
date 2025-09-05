// src/ai/compliance/compliance.ts

import crypto from "crypto";
import type { Channel } from "../feedback/feedback-store";

export type Region = "US" | "CA" | "EU" | "UK" | "OTHER";

export interface SubjectMeta {
  region: Region;
  state?: string;            // e.g., "CA","NY"
  doNotCall?: boolean;
  doNotEmail?: boolean;
  doNotSell?: boolean;       // CPRA "Do Not Sell or Share"
  consentEmail?: boolean;    // recorded opt-in
  consentSMS?: boolean;      // recorded opt-in
  b2b?: boolean;             // business contact
}

export interface ProviderUsage {
  name: string;              // e.g., "Google Opal", "SerpAPI"
  plan: "free" | "pro";
  maxRps?: number;           // declared throttle
  dailyCap?: number;
  allowsContactDiscovery?: boolean; // whether ToS allows using for contact info
  scrapingAllowed?: boolean;        // whether indexing/scraping is permitted
  notes?: string[];
}

export interface ProcessingContext {
  purpose: "lead_generation" | "analytics" | "service_delivery";
  lawfulBasis: "consent" | "legitimate_interests" | "contract";
  providers: ProviderUsage[];
}

export interface Contact {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  channelHints?: Channel[];
  company?: string;
  website?: string;
  meta?: Record<string, unknown>;
}

export interface PolicyDecision {
  allowed: boolean;
  reasons: string[];
  redactions?: Partial<Contact>;
}

/** In-memory consent registry (replace with DB in production). */
export class ConsentRegistry {
  private emailConsent = new Map<string, boolean>();
  private smsConsent = new Map<string, boolean>();

  setEmail(email: string, consent: boolean) { this.emailConsent.set(norm(email), consent); }
  setSMS(phone: string, consent: boolean) { this.smsConsent.set(norm(phone), consent); }

  hasEmail(email?: string) { return email ? !!this.emailConsent.get(norm(email)) : false; }
  hasSMS(phone?: string) { return phone ? !!this.smsConsent.get(norm(phone)) : false; }
}

export class DataGuard {
  constructor(private ctx: ProcessingContext, private consent = new ConsentRegistry()) {}

  assessProviderUse(): PolicyDecision {
    const reasons: string[] = [];
    for (const p of this.ctx.providers) {
      if (p.plan === "free" && (p.maxRps ?? 0) === 0) reasons.push(`${p.name}: unspecified throttle on free tier`);
      if (p.plan === "free" && p.dailyCap && p.dailyCap < 100) reasons.push(`${p.name}: very small daily cap`);
      if (p.allowsContactDiscovery === false) reasons.push(`${p.name}: ToS forbids contact discovery`);
      if (p.scrapingAllowed === false) reasons.push(`${p.name}: scraping/indexing not permitted`);
    }
    return { allowed: reasons.length === 0, reasons: reasons.length ? reasons : ["ok"] };
  }

  /** Decide if we can outreach this subject over a channel. */
  canContact(channel: Channel, subject: SubjectMeta, c: Contact): PolicyDecision {
    const reasons: string[] = [];

    // Per-region conservative rules (non-legal advice; encode strict defaults)
    if (channel === "phone") {
      if (subject.doNotCall) reasons.push("subject DNC");
      if (subject.region === "US" && !this.consent.hasSMS(c.phone)) reasons.push("US TCPA: no prior express consent for calls/SMS");
      if (subject.region === "CA" && !subject.consentSMS) reasons.push("CASL: no SMS consent");
      if (subject.region === "EU" || subject.region === "UK") reasons.push("EU/UK: avoid cold calls without consent/legitimate interest assessment");
    }
    if (channel === "email") {
      if (subject.doNotEmail) reasons.push("subject DNE");
      if (subject.region === "CA" && !this.consent.hasEmail(c.email)) reasons.push("CASL: requires opt-in for CEMs");
      if ((subject.region === "EU" || subject.region === "UK") && !subject.consentEmail && !subject.b2b)
        reasons.push("EU/UK: opt-in or strong LI required");
    }
    if (channel === "instagram" || channel === "x" || channel === "linkedin") {
      // Platform policies vary; avoid automation if disallowed.
      reasons.push("check platform anti-automation policy before DM outreach");
    }
    if (subject.doNotSell) reasons.push("subject requested Do Not Sell/Share (limit data sharing)");

    const redactions: Partial<Contact> = {};
    if (reasons.length) {
      // Redact direct identifiers if not allowed to contact
      if (!this.consent.hasEmail(c.email)) redactions.email = c.email ? hash(c.email) : undefined;
      if (!this.consent.hasSMS(c.phone)) redactions.phone = c.phone ? hash(c.phone) : undefined;
    }
    return { allowed: reasons.length === 0, reasons: reasons.length ? reasons : ["ok"], redactions };
  }

  /** Scrub PII in free plan logs and payloads. */
  sanitizeForPlan<T = unknown>(payload: T, plan: "free" | "pro"): T {
    if (plan === "pro") return payload;
    return deepMap(payload, (k, v) => {
      if (k.toLowerCase().includes("email") && typeof v === "string") return hash(v);
      if (k.toLowerCase().includes("phone") && typeof v === "string") return hash(v);
      if (k.toLowerCase().includes("name") && typeof v === "string") return redactName(v);
      return v;
    });
  }

  /** Quick robots/terms check switch fed by your crawler config. */
  isCrawlAllowed(meta: { robotsAllowed?: boolean; termsAllow?: boolean }): boolean {
    if (meta.robotsAllowed === false) return false;
    if (meta.termsAllow === false) return false;
    return true;
  }

  /** Compute safe concurrency based on provider caps. */
  safeConcurrency(budget = 1.0) {
    const caps = this.ctx.providers.map(p => (p.maxRps ?? 1) * (p.plan === "free" ? 0.5 : 1));
    const minRps = caps.length ? Math.max(0.2, Math.min(...caps)) : 1;
    return Math.max(1, Math.floor(minRps * 10 * budget));
  }
}

/** Utility: redact email/phone from arbitrary text (logging). */
export function redactPII(text: string) {
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const phone = /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?){1,2}\d{4}\b/g;
  return text.replace(email, "***@***").replace(phone, "**********");
}

export function hash(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function redactName(name: string) {
  if (!name.trim()) return name;
  const parts = name.split(/\s+/);
  const first = parts[0][0]?.toUpperCase() ?? "";
  const last = parts[parts.length - 1][0]?.toUpperCase() ?? "";
  return `${first}.${last}.`;
}

function deepMap<T>(obj: T, fn: (k: string, v: any) => any): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => deepMap(v, fn)) as any;
  const out: any = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj as any)) {
    if (v && typeof v === "object") out[k] = deepMap(v, fn);
    else out[k] = fn(k, v);
  }
  return out;
}

function norm(s: string) { return s.trim().toLowerCase(); }

/** Filter contacts list for compliance and return allowed + redacted blocked. */
export function filterContacts(
  contacts: Contact[],
  subject: SubjectMeta,
  guard: DataGuard,
  channel: Channel
) {
  const allowed: Contact[] = [];
  const blocked: Contact[] = [];
  for (const c of contacts) {
    const decision = guard.canContact(channel, subject, c);
    if (decision.allowed) {
      allowed.push(c);
    } else {
      blocked.push({ ...c, ...decision.redactions });
    }
  }
  return { allowed, blocked };
}
