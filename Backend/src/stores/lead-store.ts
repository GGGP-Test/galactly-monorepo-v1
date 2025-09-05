/* 
  LeadStore: durable(ish) lead repository with in-memory index + optional JSONL append log.
  - Dedupes by canonical domain + normalized name using DedupeIndex.
  - Exposes stage mutations and scoring updates.
  - Emits events for downstream pipeline pieces (notifications, UI, learning-store).
*/

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import type {
  LeadId,
  LeadStage,
  LeadScorecard,
  LeadSignal,
  LeadContact,
  LeadOrigin,
} from '../types';
import { DedupeIndex } from '../core/dedupe-index';
import { nowIso, stableHash, normalizeDomain, redactForLog } from '../core/job-utils';
import { AuditLog } from '../ops/audit-log';

export interface Lead {
  id: LeadId;
  name: string;
  domain?: string;                     // normalized company domain
  website?: string;                    // original URL
  canonicalUrl?: string;               // preferred homepage
  origin?: LeadOrigin;                 // seed, crawl, upload, api, manual
  stage: LeadStage;                    // new|qualified|outreach|engaged|won|lost|spam
  score?: number;                      // 0-100 overall
  scorecard?: LeadScorecard;           // component scores
  signals?: LeadSignal[];              // extracted signals
  contacts?: LeadContact[];            // resolved via contacts-resolver
  tags?: string[];
  meta?: Record<string, unknown>;      // enrichment payloads
  createdAt: string;                   // ISO
  updatedAt: string;                   // ISO
  deletedAt?: string | null;
  notes?: string;
}

export interface LeadQuery {
  q?: string;                          // free text query over name/domain/tags
  tags?: string[];
  stage?: LeadStage | LeadStage[];
  minScore?: number;
  maxAgeDays?: number;
  limit?: number;
  offset?: number;
}

export interface LeadPatch {
  name?: string;
  domain?: string;
  website?: string;
  canonicalUrl?: string;
  stage?: LeadStage;
  score?: number;
  scorecard?: LeadScorecard;
  signals?: LeadSignal[];
  contacts?: LeadContact[];
  tags?: string[];
  meta?: Record<string, unknown>;
  notes?: string;
}

export type LeadStoreEvent =
  | { type: 'lead.created'; lead: Lead }
  | { type: 'lead.updated'; lead: Lead; changes: Partial<Lead> }
  | { type: 'lead.deleted'; lead: Lead }
  | { type: 'lead.stage-changed'; lead: Lead; from: LeadStage; to: LeadStage }
  | { type: 'lead.scored'; lead: Lead; score: number; scorecard?: LeadScorecard };

export interface LeadStoreOptions {
  jsonlPath?: string;                  // if provided, appends mutations for durability
  namespace?: string;                  // separate indexes per namespace (tenant)
}

export class LeadStore extends EventEmitter {
  private map = new Map<LeadId, Lead>();
  private byDomain = new Map<string, LeadId>();      // normalized domain -> leadId
  private byNameKey = new Map<string, LeadId>();     // normalized company name -> leadId
  private dedupe: DedupeIndex;
  private jsonlPath?: string;
  private ns: string;

  constructor(opts: LeadStoreOptions = {}) {
    super();
    this.jsonlPath = opts.jsonlPath;
    this.ns = opts.namespace ?? 'default';
    this.dedupe = new DedupeIndex({ namespace: `lead:${this.ns}` });
    if (this.jsonlPath) this.ensureLogFile(this.jsonlPath);
  }

  /** Upsert lead; dedupes by domain or name key. Returns the canonical record. */
  upsert(input: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Lead, 'id'>>): Lead {
    const now = nowIso();
    const domain = input.domain ? normalizeDomain(input.domain) : (input.website ? normalizeDomain(input.website) : undefined);
    const nameKey = normalizeCompanyKey(input.name);

    // Try locate an existing lead
    let existingId: LeadId | undefined =
      (domain && this.byDomain.get(domain)) ||
      this.byNameKey.get(nameKey) ||
      (input.id && this.map.has(input.id) ? input.id : undefined);

    let lead: Lead;
    if (existingId) {
      const current = this.map.get(existingId)!;
      const patch: LeadPatch = { ...input } as any;
      delete (patch as any).id;
      lead = this.applyPatch(current, patch, now);
      this.map.set(lead.id, lead);
      this.indexLead(lead);
      this.append('update', lead);
      this.emitEvent({ type: 'lead.updated', lead, changes: patch });
      if (typeof lead.score === 'number')
        this.emitEvent({ type: 'lead.scored', lead, score: lead.score, scorecard: lead.scorecard });
    } else {
      const id = input.id ?? generateLeadId(input.name, domain);
      lead = {
        id,
        name: input.name,
        website: input.website,
        canonicalUrl: input.canonicalUrl ?? input.website,
        domain,
        origin: input.origin ?? 'crawl',
        stage: input.stage ?? 'new',
        score: input.score ?? undefined,
        scorecard: input.scorecard,
        signals: input.signals ?? [],
        contacts: input.contacts ?? [],
        tags: input.tags ?? [],
        meta: input.meta ?? {},
        createdAt: now,
        updatedAt: now,
        notes: input.notes,
      };
      this.map.set(id, lead);
      this.indexLead(lead);
      this.append('create', lead);
      this.emitEvent({ type: 'lead.created', lead });
      if (typeof lead.score === 'number')
        this.emitEvent({ type: 'lead.scored', lead, score: lead.score, scorecard: lead.scorecard });
    }

    // mark dedupe signature to avoid future duplicates
    const sigs = dedupeSignatures(lead);
    sigs.forEach((s) => this.dedupe.remember(s, lead.id));

    AuditLog.log('lead.upsert', redactForLog(lead));
    return lead;
  }

  get(id: LeadId): Lead | undefined {
    return this.map.get(id);
  }

  byCanonicalDomain(domainOrUrl: string): Lead | undefined {
    const d = normalizeDomain(domainOrUrl);
    const id = this.byDomain.get(d);
    return id ? this.map.get(id) : undefined;
  }

  query(params: LeadQuery = {}): Lead[] {
    const {
      q,
      tags,
      stage,
      minScore,
      maxAgeDays,
      limit = 100,
      offset = 0,
    } = params;

    const stages = Array.isArray(stage) ? stage : stage ? [stage] : undefined;
    const now = Date.now();
    const maxAgeMs = maxAgeDays ? maxAgeDays * 24 * 60 * 60 * 1000 : undefined;

    const hay = (q ?? '').toLowerCase();

    let list = Array.from(this.map.values())
      .filter((l) => !l.deletedAt);

    if (stages?.length) list = list.filter((l) => stages.includes(l.stage));
    if (typeof minScore === 'number') list = list.filter((l) => (l.score ?? -1) >= minScore);
    if (maxAgeMs) list = list.filter((l) => now - new Date(l.createdAt).getTime() <= maxAgeMs);
    if (tags?.length) list = list.filter((l) => (l.tags ?? []).some((t) => tags.includes(t)));

    if (hay) {
      list = list.filter((l) => {
        const bag = [
          l.name,
          l.domain,
          l.website,
          ...(l.tags ?? []),
          ...(l.contacts ?? []).map((c) => c.email ?? c.name ?? '').filter(Boolean),
        ].join(' ').toLowerCase();
        return bag.includes(hay);
      });
    }

    return list.slice(offset, offset + limit);
  }

  updateStage(id: LeadId, to: LeadStage): Lead | undefined {
    const lead = this.map.get(id);
    if (!lead) return;
    if (lead.stage === to) return lead;
    const from = lead.stage;
    lead.stage = to;
    lead.updatedAt = nowIso();
    this.map.set(id, lead);
    this.append('stage', lead, { from, to });
    this.emitEvent({ type: 'lead.stage-changed', lead, from, to });
    AuditLog.log('lead.stage', { id: lead.id, from, to });
    return lead;
  }

  patch(id: LeadId, patch: LeadPatch): Lead | undefined {
    const current = this.map.get(id);
    if (!current) return;
    const now = nowIso();
    const next = this.applyPatch(current, patch, now);
    this.map.set(id, next);
    this.indexLead(next);
    this.append('update', next);
    this.emitEvent({ type: 'lead.updated', lead: next, changes: patch });
    if (typeof next.score === 'number')
      this.emitEvent({ type: 'lead.scored', lead: next, score: next.score, scorecard: next.scorecard });
    return next;
  }

  remove(id: LeadId): boolean {
    const existing = this.map.get(id);
    if (!existing) return false;
    existing.deletedAt = nowIso();
    existing.updatedAt = existing.deletedAt;
    this.map.set(id, existing);
    this.append('delete', existing);
    this.emitEvent({ type: 'lead.deleted', lead: existing });
    AuditLog.log('lead.delete', { id });
    return true;
  }

  /** Merge duplicate `loserId` into `winnerId` (keeps winner's id). */
  merge(winnerId: LeadId, loserId: LeadId): Lead | undefined {
    const a = this.map.get(winnerId);
    const b = this.map.get(loserId);
    if (!a || !b) return;

    const merged: Lead = {
      ...a,
      name: choose(a.name, b.name),
      website: choose(a.website, b.website),
      canonicalUrl: choose(a.canonicalUrl, b.canonicalUrl),
      domain: choose(a.domain, b.domain),
      origin: a.origin ?? b.origin,
      stage: rankStage(a.stage, b.stage),
      score: Math.max(a.score ?? -1, b.score ?? -1, 0),
      scorecard: { ...(a.scorecard ?? {}), ...(b.scorecard ?? {}) },
      signals: dedupeArray([...(a.signals ?? []), ...(b.signals ?? [])], sigKey),
      contacts: dedupeArray([...(a.contacts ?? []), ...(b.contacts ?? [])], contactKey),
      tags: Array.from(new Set([...(a.tags ?? []), ...(b.tags ?? [])])),
      meta: { ...(a.meta ?? {}), ...(b.meta ?? {}) },
      notes: [a.notes, b.notes].filter(Boolean).join('\n'),
      createdAt: a.createdAt <= b.createdAt ? a.createdAt : b.createdAt,
      updatedAt: nowIso(),
    };

    this.map.set(winnerId, merged);
    this.remove(loserId);
    this.indexLead(merged);
    this.append('merge', merged, { mergedFrom: loserId });
    this.emitEvent({ type: 'lead.updated', lead: merged, changes: { mergedFrom: loserId } as any });
    return merged;
  }

  size(): number {
    return this.map.size;
  }

  /** For bootstrap: load from an existing JSONL file (idempotent). */
  loadFromJsonl(jsonlPath: string): number {
    if (!fs.existsSync(jsonlPath)) return 0;
    const text = fs.readFileSync(jsonlPath, 'utf8');
    let count = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'create' || evt.type === 'update' || evt.type === 'merge' || evt.type === 'stage') {
          const lead = evt.lead as Lead;
          this.map.set(lead.id, lead);
          this.indexLead(lead);
          count++;
        }
      } catch {
        // skip bad line
      }
    }
    return count;
  }

  // === internals ===

  private indexLead(lead: Lead) {
    if (lead.domain) this.byDomain.set(lead.domain, lead.id);
    this.byNameKey.set(normalizeCompanyKey(lead.name), lead.id);
  }

  private applyPatch(current: Lead, patch: LeadPatch, now: string): Lead {
    const next: Lead = { ...current, ...patch, updatedAt: now };
    if (patch.domain || patch.website) {
      const d = patch.domain ? normalizeDomain(patch.domain) : (patch.website ? normalizeDomain(patch.website) : current.domain);
      next.domain = d;
    }
    return next;
  }

  private ensureLogFile(p: string) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(p)) fs.writeFileSync(p, '');
  }

  private append(type: string, lead: Lead, extra: Record<string, unknown> = {}) {
    if (!this.jsonlPath) return;
    const line = JSON.stringify({ ts: Date.now(), type, lead, ...extra }) + '\n';
    fs.appendFile(this.jsonlPath, line, () => {});
  }

  private emitEvent(evt: LeadStoreEvent) {
    this.emit('event', evt);
  }
}

// === helpers ===

function generateLeadId(name: string, domain?: string): LeadId {
  return ('ld_' + stableHash([name.trim().toLowerCase(), domain ?? ''].join('|'))).slice(0, 32) as LeadId;
}

function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function dedupeSignatures(lead: Lead): string[] {
  const sigs: string[] = [];
  if (lead.domain) sigs.push(`domain:${lead.domain}`);
  sigs.push(`name:${normalizeCompanyKey(lead.name)}`);
  if (lead.website) sigs.push(`url:${normalizeDomain(lead.website)}`);
  return sigs;
}

function choose<T>(a?: T, b?: T): T | undefined {
  return (a ?? b) as any;
}

function rankStage(a: LeadStage, b: LeadStage): LeadStage {
  const order: LeadStage[] = ['spam', 'new', 'qualified', 'outreach', 'engaged', 'won', 'lost'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function sigKey(s: LeadSignal): string {
  return `${s.type}:${s.key ?? ''}:${s.value ?? ''}`;
}

function contactKey(c: LeadContact): string {
  return (c.email ?? c.phone ?? c.name ?? JSON.stringify(c)).toLowerCase();
}

function dedupeArray<T>(arr: T[], keyFn: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of arr) {
    const k = keyFn(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
