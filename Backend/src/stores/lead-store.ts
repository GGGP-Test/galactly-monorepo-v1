export type LeadId = string;
export type LeadStage = 'new' | 'qualified' | 'outreach' | 'engaged' | 'won' | 'lost' | 'spam';

export interface Lead {
  id: LeadId;
  name: string;
  domain?: string;
  website?: string;
  stage: LeadStage;
  score?: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface LeadPatch {
  name?: string;
  domain?: string;
  website?: string;
  stage?: LeadStage;
  score?: number;
  tags?: string[];
}

export class LeadStore {
  private map = new Map<LeadId, Lead>();

  upsert(input: Omit<Lead, 'createdAt' | 'updatedAt'>): Lead {
    const now = new Date().toISOString();
    const existing = this.map.get(input.id);
    const next: Lead = existing
      ? { ...existing, ...input, updatedAt: now }
      : { ...input, createdAt: now, updatedAt: now };

    this.map.set(next.id, next);
    return next;
  }

  get(id: LeadId): Lead | undefined {
    return this.map.get(id);
  }

  patch(id: LeadId, patch: LeadPatch): Lead | undefined {
    const cur = this.map.get(id);
    if (!cur) return;
    const next: Lead = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.map.set(id, next);
    return next;
  }

  remove(id: LeadId): boolean {
    const cur = this.map.get(id);
    if (!cur) return false;
    cur.deletedAt = new Date().toISOString();
    cur.updatedAt = cur.deletedAt;
    this.map.set(id, cur);
    return true;
  }

  list(): Lead[] {
    return Array.from(this.map.values()).filter(l => !l.deletedAt);
  }
}
