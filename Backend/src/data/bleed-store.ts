// src/data/bleed-store.ts
/**
 * BLEED Store = Business Lead Evidence, Events & Decisions
 * Central append-only store for lead records + supporting evidence + decision trail.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { dirname } from "path";

// ----------------- Types -----------------
export type LeadStatus =
  | "new"
  | "enriched"
  | "qualified"
  | "routed"
  | "contacted"
  | "won"
  | "lost"
  | "archived";

export interface ContactRef {
  name?: string;
  role?: string;
  emailHash?: string; // hashed; raw PII should live in pii-vault
  phoneHash?: string;
  linkedin?: string;
  confidence?: number; // 0..1
}

export interface LeadRecord {
  id: string;
  tenantId: string;
  source: string; // "opal" | "google" | "dir:c-pacs" | "seed" | "web:ddg" | ...
  company?: string;
  domain?: string;
  website?: string;
  country?: string;
  region?: string;
  verticals?: string[];
  signals?: Record<string, number | string>;
  scores?: Record<string, number>; // "intent", "fit", "timing", "trust"...
  contacts?: ContactRef[];
  status: LeadStatus;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
}

export interface Evidence {
  id: string;
  leadId: string;
  ts: number;
  kind:
    | "ad_snapshot"
    | "pricing_page"
    | "careers_posting"
    | "tech_tag"
    | "news"
    | "review"
    | "social_post"
    | "directory_row"
    | "catalog_listing"
    | "email_bounce"
    | "reply_positive"
    | "reply_negative";
  url?: string;
  snippet?: string; // short extract
  weight?: number; // 0..1 effect toward intent/fit/…
  meta?: Record<string, unknown>;
}

export interface Decision {
  id: string;
  leadId: string;
  ts: number;
  by: "system" | "user";
  actorId?: string;
  type: "ROUTE" | "APPROVE" | "REJECT" | "PAUSE" | "RESCORE" | "ARCHIVE";
  reason?: string;
  meta?: Record<string, unknown>;
}

export interface BleedStore {
  upsertLead(lead: Partial<LeadRecord> & { tenantId: string }): Promise<LeadRecord>;
  getLead(tenantId: string, id: string): Promise<LeadRecord | undefined>;
  listLeads(
    tenantId: string,
    opts?: { status?: LeadStatus; limit?: number; search?: string }
  ): Promise<LeadRecord[]>;
  addEvidence(ev: Omit<Evidence, "id" | "ts"> & { ts?: number }): Promise<Evidence>;
  listEvidence(leadId: string, limit?: number): Promise<Evidence[]>;
  addDecision(d: Omit<Decision, "id" | "ts"> & { ts?: number }): Promise<Decision>;
  listDecisions(leadId: string, limit?: number): Promise<Decision[]>;
  updateScores(tenantId: string, id: string, scores: Record<string, number>): Promise<LeadRecord | undefined>;
  setStatus(tenantId: string, id: string, status: LeadStatus): Promise<LeadRecord | undefined>;
  exportTenant(tenantId: string): Promise<{ leads: LeadRecord[]; evidence: Evidence[]; decisions: Decision[] }>;
}

// ----------------- utils -----------------
function now() {
  return Date.now();
}
function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}
function mergeContacts(a?: ContactRef[], b?: ContactRef[]) {
  if (!a || a.length === 0) return b || [];
  if (!b || b.length === 0) return a;
  const out: ContactRef[] = [...a];
  for (const c of b) {
    const key = c.emailHash || c.phoneHash || c.linkedin || (c.name ? c.name.toLowerCase() : "");
    const exists = out.find(
      (x) => (x.emailHash || x.phoneHash || x.linkedin || (x.name ? x.name.toLowerCase() : "")) === key
    );
    if (!exists) out.push(c);
  }
  return out;
}

// ----------------- In-memory store -----------------
export class MemoryBleedStore implements BleedStore {
  protected leads = new Map<string, LeadRecord>(); // key leadId
  protected evByLead = new Map<string, Evidence[]>();
  protected decByLead = new Map<string, Decision[]>();

  async upsertLead(lead: Partial<LeadRecord> & { tenantId: string }): Promise<LeadRecord> {
    // merge by (tenantId + domain) or explicit id
    const existing = lead.id
      ? this.leads.get(lead.id)
      : [...this.leads.values()].find(
          (l) => l.tenantId === lead.tenantId && l.domain && lead.domain && l.domain === lead.domain
        );

    if (existing) {
      const merged: LeadRecord = {
        ...existing,
        ...lead,
        id: existing.id,
        signals: { ...(existing.signals || {}), ...(lead.signals || {}) },
        scores: { ...(existing.scores || {}), ...(lead.scores || {}) },
        contacts: mergeContacts(existing.contacts, lead.contacts),
        verticals: uniq([...(existing.verticals || []), ...(lead.verticals || [])]),
        updatedAt: now(),
      };
      this.leads.set(merged.id, merged);
      return merged;
    }

    const record: LeadRecord = {
      id: lead.id || genId(),
      tenantId: lead.tenantId,
      source: lead.source || "unknown",
      company: lead.company,
      domain: lead.domain,
      website: lead.website,
      country: lead.country,
      region: lead.region,
      verticals: lead.verticals || [],
      signals: lead.signals || {},
      scores: lead.scores || {},
      contacts: lead.contacts || [],
      status: lead.status || "new",
      createdAt: now(),
      updatedAt: now(),
      meta: lead.meta || {},
    };
    this.leads.set(record.id, record);
    return record;
  }

  async getLead(_tenantId: string, id: string): Promise<LeadRecord | undefined> {
    return this.leads.get(id);
  }

  async listLeads(
    tenantId: string,
    opts?: { status?: LeadStatus; limit?: number; search?: string }
  ): Promise<LeadRecord[]> {
    let arr = [...this.leads.values()].filter((l) => l.tenantId === tenantId);
    if (opts?.status) arr = arr.filter((l) => l.status === opts.status);
    if (opts?.search) {
      const s = opts.search.toLowerCase();
      arr = arr.filter((l) => (l.company || "").toLowerCase().includes(s) || (l.domain || "").includes(s));
    }
    arr.sort((a, b) => b.updatedAt - a.updatedAt);
    return arr.slice(0, opts?.limit || 200);
  }

  async addEvidence(ev: Omit<Evidence, "id" | "ts"> & { ts?: number }): Promise<Evidence> {
    const e: Evidence = { ...ev, id: genId(), ts: ev.ts || now() };
    if (!this.evByLead.has(e.leadId)) this.evByLead.set(e.leadId, []);
    this.evByLead.get(e.leadId)!.push(e);
    return e;
  }

  async listEvidence(leadId: string, limit = 100): Promise<Evidence[]> {
    const arr = this.evByLead.get(leadId) || [];
    return arr.slice(-limit);
  }

  async addDecision(d: Omit<Decision, "id" | "ts"> & { ts?: number }): Promise<Decision> {
    const dec: Decision = { ...d, id: genId(), ts: d.ts || now() };
    if (!this.decByLead.has(dec.leadId)) this.decByLead.set(dec.leadId, []);
    this.decByLead.get(dec.leadId)!.push(dec);
    return dec;
  }

  async listDecisions(leadId: string, limit = 100): Promise<Decision[]> {
    const arr = this.decByLead.get(leadId) || [];
    return arr.slice(-limit);
  }

  async updateScores(_tenantId: string, id: string, scores: Record<string, number>): Promise<LeadRecord | undefined> {
    const lead = this.leads.get(id);
    if (!lead) return;
    lead.scores = { ...(lead.scores || {}), ...scores };
    lead.updatedAt = now();
    this.leads.set(id, lead);
    return lead;
  }

  async setStatus(_tenantId: string, id: string, status: LeadStatus): Promise<LeadRecord | undefined> {
    const lead = this.leads.get(id);
    if (!lead) return;
    lead.status = status;
    lead.updatedAt = now();
    this.leads.set(id, lead);
    return lead;
  }

  async exportTenant(tenantId: string) {
    const leads = [...this.leads.values()].filter((l) => l.tenantId === tenantId);
    const evidence: Evidence[] = [];
    const decisions: Decision[] = [];
    for (const l of leads) {
      evidence.push(...(this.evByLead.get(l.id) || []));
      decisions.push(...(this.decByLead.get(l.id) || []));
    }
    return { leads, evidence, decisions };
  }
}

// ----------------- File-backed store -----------------
export class FileBleedStore extends MemoryBleedStore {
  constructor(
    private basePath: string // creates three files: .leads.json, .evidence.jsonl, .decisions.jsonl
  ) {
    super();
    const dir = dirname(basePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(this.leadsPath())) writeFileSync(this.leadsPath(), JSON.stringify([]));
    if (!existsSync(this.evPath())) writeFileSync(this.evPath(), "");
    if (!existsSync(this.decPath())) writeFileSync(this.decPath(), "");

    // Warm-load leads synchronously (no async/await here)
    try {
      const leads = JSON.parse(readFileSync(this.leadsPath(), "utf8")) as LeadRecord[];
      for (const l of leads) {
        // upsertLead is async, but for warm-load we don't need to await
        super.upsertLead(l);
      }
    } catch {
      /* ignore corrupt file on startup */
    }
  }

  private leadsPath() {
    return this.basePath + ".leads.json";
  }
  private evPath() {
    return this.basePath + ".evidence.jsonl";
  }
  private decPath() {
    return this.basePath + ".decisions.jsonl";
  }

  override async upsertLead(lead: Partial<LeadRecord> & { tenantId: string }): Promise<LeadRecord> {
    const r = await super.upsertLead(lead);
    // rewrite leads file atomically-ish (small volumes)
    try {
      const existing = JSON.parse(readFileSync(this.leadsPath(), "utf8")) as LeadRecord[];
      const i = existing.findIndex((x) => x.id === r.id);
      if (i >= 0) existing[i] = r;
      else existing.push(r);
      writeFileSync(this.leadsPath(), JSON.stringify(existing, null, 2));
    } catch {
      // rebuild file from memory snapshot if parse fails
      const snapshot = [...(this as any).leads.values()] as LeadRecord[];
      writeFileSync(this.leadsPath(), JSON.stringify(snapshot, null, 2));
    }
    return r;
  }

  override async addEvidence(ev: Omit<Evidence, "id" | "ts"> & { ts?: number }): Promise<Evidence> {
    const e = await super.addEvidence(ev);
    appendFileSync(this.evPath(), JSON.stringify(e) + "\n");
    return e;
  }

  override async addDecision(d: Omit<Decision, "id" | "ts"> & { ts?: number }): Promise<Decision> {
    const dec = await super.addDecision(d);
    appendFileSync(this.decPath(), JSON.stringify(dec) + "\n");
    return dec;
  }
}