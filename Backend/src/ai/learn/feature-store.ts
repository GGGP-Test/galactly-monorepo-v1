// src/ai/learn/feature-store.ts
/**
 * Lightweight online feature store for Pro/Scale plans.
 * - Records events (viewed, contacted, replied, quoted, won, lost)
 * - Builds per-lead, per-org features (+ rolling success priors)
 * - Avoids storing PII; use leadId/orgId references only
 *
 * Pluggable backends: InMemory (default) and Postgres (optional).
 */
export type EventName = "viewed" | "contacted" | "replied" | "quoted" | "won" | "lost";
export interface Event {
  orgId: string;
  leadId: string;
  at: number; // epoch ms
  name: EventName;
  meta?: Record<string, any>; // must NOT contain PII; keep it anonymous labels/ids
}

export interface Features {
  orgId: string;
  leadId: string;
  counts: Record<EventName, number>;
  lastSeenAt?: number;
  conversionRate30d: number; // replies/contacted in last 30d
  winRate90d: number;        // won/(won+lost) in last 90d
  channelHints?: Record<string, number>; // e.g., {"email": 0.7, "linkedin": 0.4}
}

export interface FeatureStore {
  record(ev: Event): Promise<void>;
  batchRecord(ev: Event[]): Promise<void>;
  features(orgId: string, leadId: string): Promise<Features>;
}

const now = () => Date.now();

class InMemoryStore implements FeatureStore {
  private events: Map<string, Event[]> = new Map(); // key = orgId:leadId
  async record(ev: Event) {
    const key = `${ev.orgId}:${ev.leadId}`;
    const arr = this.events.get(key) || [];
    arr.push(ev);
    this.events.set(key, arr);
  }
  async batchRecord(list: Event[]) {
    for (const ev of list) await this.record(ev);
  }
  async features(orgId: string, leadId: string): Promise<Features> {
    const key = `${orgId}:${leadId}`;
    const arr = (this.events.get(key) || []).slice().sort((a, b) => a.at - b.at);
    const counts = { viewed: 0, contacted: 0, replied: 0, quoted: 0, won: 0, lost: 0 } as Record<EventName, number>;
    const t = now();
    let lastSeenAt = 0;
    let last30_contacted = 0, last30_replied = 0;
    let w=0, l=0;

    for (const e of arr) {
      counts[e.name]++;
      lastSeenAt = Math.max(lastSeenAt, e.at);
      if (t - e.at <= 30*24*3600*1000) {
        if (e.name === "contacted") last30_contacted++;
        if (e.name === "replied") last30_replied++;
      }
      if (t - e.at <= 90*24*3600*1000) {
        if (e.name === "won") w++;
        if (e.name === "lost") l++;
      }
    }
    const conversionRate30d = last30_contacted ? last30_replied / last30_contacted : 0;
    const winRate90d = (w + l) ? w / (w + l) : 0;

    // naive channel hints: last 20 events meta.channel success weights
    const channelHints: Record<string, number> = {};
    const recent = arr.slice(-20);
    for (const e of recent) {
      const ch = e.meta?.channel;
      if (!ch) continue;
      const delta = e.name === "replied" || e.name === "won" ? 1 : e.name === "lost" ? -0.5 : 0;
      channelHints[ch] = (channelHints[ch] || 0) + delta;
    }

    return { orgId, leadId, counts, lastSeenAt, conversionRate30d, winRate90d, channelHints };
  }
}

/** Optional Postgres adapter (requires `pg`). Safe to ignore if not installed. */
export class PostgresFeatureStore implements FeatureStore {
  private client: any;
  private ready = false;
  constructor(connString = process.env.DATABASE_URL) {
    if (!connString) throw new Error("DATABASE_URL missing for PostgresFeatureStore");
    // Lazy import to avoid hard dep
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require("pg");
    this.client = new Client({ connectionString: connString });
  }
  async init() {
    if (this.ready) return;
    await this.client.connect();
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS lead_events (
        org_id text NOT NULL,
        lead_id text NOT NULL,
        at     BIGINT NOT NULL,
        name   text NOT NULL,
        meta   jsonb,
        PRIMARY KEY (org_id, lead_id, at, name)
      );`);
    this.ready = true;
  }
  async record(ev: Event) {
    await this.init();
    await this.client.query(
      `INSERT INTO lead_events (org_id, lead_id, at, name, meta) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [ev.orgId, ev.leadId, ev.at, ev.name, ev.meta || {}]
    );
  }
  async batchRecord(list: Event[]) {
    for (const e of list) await this.record(e);
  }
  async features(orgId: string, leadId: string): Promise<Features> {
    await this.init();
    const { rows } = await this.client.query(
      `SELECT at, name, meta FROM lead_events WHERE org_id=$1 AND lead_id=$2 ORDER BY at ASC`,
      [orgId, leadId]
    );
    const mem = new InMemoryStore();
    await mem.batchRecord(rows.map((r: any) => ({ orgId, leadId, at: Number(r.at), name: r.name as EventName, meta: r.meta })));
    return mem.features(orgId, leadId);
  }
}

/** Factory */
export function createFeatureStore(): FeatureStore {
  if (process.env.DATABASE_URL) return new PostgresFeatureStore();
  return new InMemoryStore();
}
