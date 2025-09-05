// src/security/audit-log.ts
import { createHash, randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

export type AuditSeverity = "INFO" | "WARN" | "ERROR" | "SECURITY" | "COMPLIANCE";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "TOKEN_ISSUED"
  | "TOKEN_REVOKED"
  | "MODEL_CALL"
  | "LEAD_SEED"
  | "LEAD_CREATED"
  | "LEAD_UPDATED"
  | "LEAD_DEDUPED"
  | "LEAD_ENRICHED"
  | "PIPELINE_RUN"
  | "CRAWL_START"
  | "CRAWL_END"
  | "OUTREACH_SENT"
  | "OUTREACH_BOUNCE"
  | "RATE_LIMIT"
  | "CONFIG_CHANGE"
  | "EXPORT";

export interface AuditActor {
  type: "system" | "user" | "api";
  id?: string; // userId / clientId / serviceId
  ip?: string;
  ua?: string;
}

export interface AuditTarget {
  type: string; // "lead" | "job" | "org" | "url" | "model" ...
  id?: string;
  path?: string; // e.g., "/lead/123"
}

export interface AuditEvent {
  id: string;
  ts: number;
  tenantId?: string;
  action: AuditAction;
  severity: AuditSeverity;
  actor: AuditActor;
  target?: AuditTarget;
  meta?: Record<string, unknown>;
  prevHash?: string; // hash of previous event (per-tenant chain)
  hash: string; // tamper-evident hash(event minus hash) + prevHash
  nodeId?: string; // which node wrote the entry
}

export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
  lastHash(tenantId?: string): Promise<string | undefined>;
  query(opts?: {
    tenantId?: string;
    action?: AuditAction | AuditAction[];
    sinceTs?: number;
    untilTs?: number;
    limit?: number;
    order?: "asc" | "desc";
  }): Promise<AuditEvent[]>;
}

export interface AuditLoggerOptions {
  sink?: AuditSink;
  nodeId?: string;
  defaultTenantId?: string;
  redactFn?: (key: string, value: unknown) => unknown;
}

function defaultRedactor(key: string, value: unknown) {
  const k = key.toLowerCase();
  if (
    k.includes("password") ||
    k.includes("secret") ||
    k.includes("token") ||
    k.includes("apikey") ||
    k.includes("api_key") ||
    k.includes("authorization") ||
    k.includes("bearer")
  ) {
    return "[REDACTED]";
  }
  if (k.includes("email") && typeof value === "string") {
    const v = value.toLowerCase();
    const at = v.indexOf("@");
    if (at > 2) {
      return v.slice(0, 2) + "***" + v.slice(at - 1);
    }
    return "***" + v.slice(at);
  }
  if (k.includes("phone") && typeof value === "string") {
    return value.replace(/\d/g, (d, i) => (i < 2 ? d : "*"));
  }
  if (k.includes("content") && typeof value === "string" && value.length > 256) {
    return value.slice(0, 256) + "…[truncated]";
  }
  return value;
}

function stableStringify(obj: any, redactor: (k: string, v: unknown) => unknown) {
  return JSON.stringify(obj, (key, value) => redactor(key, value));
}

function hashEventCore(core: Omit<AuditEvent, "hash">) {
  const h = createHash("sha256");
  h.update(stableStringify(core, (k, v) => v)); // core should already be redacted
  return h.digest("hex");
}

function genId() {
  // compact ULID-ish: timestamp (ms base36) + 8 random bytes hex
  return Date.now().toString(36) + "-" + randomBytes(8).toString("hex");
}

export class MemoryAuditSink implements AuditSink {
  private events: AuditEvent[] = [];
  private lastHashByTenant = new Map<string | undefined, string>();
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    this.lastHashByTenant.set(event.tenantId, event.hash);
  }
  async lastHash(tenantId?: string): Promise<string | undefined> {
    return this.lastHashByTenant.get(tenantId);
  }
  async query(opts?: {
    tenantId?: string;
    action?: AuditAction | AuditAction[];
    sinceTs?: number;
    untilTs?: number;
    limit?: number;
    order?: "asc" | "desc";
  }): Promise<AuditEvent[]> {
    let arr = this.events.slice();
    if (opts?.tenantId !== undefined) arr = arr.filter((e) => e.tenantId === opts.tenantId);
    if (opts?.action) {
      const a = Array.isArray(opts.action) ? opts.action : [opts.action];
      arr = arr.filter((e) => a.includes(e.action));
    }
    if (opts?.sinceTs) arr = arr.filter((e) => e.ts >= opts.sinceTs!);
    if (opts?.untilTs) arr = arr.filter((e) => e.ts <= opts.untilTs!);
    arr.sort((a, b) => (opts?.order === "asc" ? a.ts - b.ts : b.ts - a.ts));
    if (opts?.limit) arr = arr.slice(0, opts.limit);
    return arr;
  }
}

export class FileAuditSink implements AuditSink {
  constructor(private filePath: string, private indexPath = filePath + ".idx") {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(filePath)) writeFileSync(filePath, "");
    if (!existsSync(indexPath)) writeFileSync(indexPath, JSON.stringify({ lastHashByTenant: {} }));
  }
  async append(event: AuditEvent): Promise<void> {
    appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf8");
    // naive index for last hash per tenant
    const idx = JSON.parse(readFileSync(this.indexPath, "utf8") || "{}");
    idx.lastHashByTenant = idx.lastHashByTenant || {};
    idx.lastHashByTenant[event.tenantId || "_none"] = event.hash;
    writeFileSync(this.indexPath, JSON.stringify(idx));
  }
  async lastHash(tenantId?: string): Promise<string | undefined> {
    const idx = JSON.parse(readFileSync(this.indexPath, "utf8") || "{}");
    return idx.lastHashByTenant?.[tenantId || "_none"];
  }
  async query(opts?: {
    tenantId?: string;
    action?: AuditAction | AuditAction[];
    sinceTs?: number;
    untilTs?: number;
    limit?: number;
    order?: "asc" | "desc";
  }): Promise<AuditEvent[]> {
    const lines = readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter(Boolean);
    let arr = lines.map((l) => JSON.parse(l) as AuditEvent);
    if (opts?.tenantId !== undefined) arr = arr.filter((e) => e.tenantId === opts.tenantId);
    if (opts?.action) {
      const a = Array.isArray(opts.action) ? opts.action : [opts.action];
      arr = arr.filter((e) => a.includes(e.action));
    }
    if (opts?.sinceTs) arr = arr.filter((e) => e.ts >= opts.sinceTs!);
    if (opts?.untilTs) arr = arr.filter((e) => e.ts <= opts.untilTs!);
    arr.sort((a, b) => (opts?.order === "asc" ? a.ts - b.ts : b.ts - a.ts));
    if (opts?.limit) arr = arr.slice(0, opts.limit);
    return arr;
  }
}

export function createAuditLogger(opts: AuditLoggerOptions = {}) {
  const sink = opts.sink || new MemoryAuditSink();
  const nodeId = opts.nodeId;
  const redact = opts.redactFn || defaultRedactor;

  async function emit(ev: Omit<AuditEvent, "id" | "hash" | "prevHash" | "ts" | "nodeId">) {
    const ts = Date.now();
    const tenantId = ev.tenantId ?? opts.defaultTenantId;
    const prevHash = await sink.lastHash(tenantId);
    const core = {
      ...ev,
      tenantId,
      ts,
      prevHash,
      nodeId,
    } as Omit<AuditEvent, "id" | "hash">;
    const id = genId();
    const redactedCore = JSON.parse(stableStringify(core, redact));
    const hash = hashEventCore({ ...redactedCore, id } as any);
    const event: AuditEvent = { ...(redactedCore as any), id, hash };
    await sink.append(event);
    return event;
  }

  return {
    emit,
    sink,
    async verifyChain(tenantId?: string) {
      const events = await sink.query({ tenantId, order: "asc" });
      let last: string | undefined;
      for (const e of events) {
        if (e.prevHash !== (last || undefined)) return false;
        const { hash, ...rest } = e;
        const expected = hashEventCore(rest as any);
        if (expected !== hash) return false;
        last = hash;
      }
      return true;
    },
  };
}

export type AuditLogger = ReturnType<typeof createAuditLogger>;
