// src/security/audit-log.ts
/**
 * Append-only audit logger with simple PII redaction.
 * Sinks: console, optional webhook, optional file.
 */

export type Severity = "info" | "warn" | "error" | "security";

export interface AuditContext {
  tenantId?: string;
  userId?: string;
  ip?: string;
  requestId?: string;
}

export interface AuditEvent {
  ts: number;
  event: string;
  severity: Severity;
  ctx?: AuditContext;
  data?: any;
}

export interface AuditSink {
  write(evt: AuditEvent): Promise<void> | void;
}

export class ConsoleSink implements AuditSink {
  write(evt: AuditEvent) {
    const line = JSON.stringify(evt);
    // eslint-disable-next-line no-console
    console.log("[audit]", line);
  }
}

export class WebhookSink implements AuditSink {
  constructor(private url: string, private secret?: string) {}
  async write(evt: AuditEvent) {
    await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.secret ? { "x-audit-secret": this.secret } : {}),
      },
      body: JSON.stringify(evt),
    }).catch(() => {});
  }
}

export class FileSink implements AuditSink {
  private queue: AuditEvent[] = [];
  private writing = false;
  constructor(private filePath: string) {}
  async write(evt: AuditEvent) {
    this.queue.push(evt);
    if (this.writing) return;
    this.writing = true;
    try {
      const fs = await import("node:fs/promises");
      while (this.queue.length) {
        const chunk = this.queue.splice(0, 50);
        const text = chunk.map((e) => JSON.stringify(e)).join("\n") + "\n";
        await fs.appendFile(this.filePath, text, "utf-8");
      }
    } catch {
      // swallow
    } finally {
      this.writing = false;
    }
  }
}

export interface AuditLogInit {
  sinks?: AuditSink[];
  redactPII?: boolean;
}

export class AuditLog {
  private sinks: AuditSink[];
  private redactPII: boolean;

  constructor(init: AuditLogInit = {}) {
    this.sinks = init.sinks?.length ? init.sinks : [new ConsoleSink()];
    this.redactPII = init.redactPII ?? true;
  }

  setSinks(sinks: AuditSink[]) { this.sinks = sinks; }

  redact(value: any): any {
    if (!this.redactPII) return value;
    try {
      const json = JSON.stringify(value);
      const scrubbed = json
        // emails
        .replace(/([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "*@$2")
        // phones (very naive)
        .replace(/\b(\+?\d{1,3}[-.\s]?)?(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g, "***-***-$4");
      return JSON.parse(scrubbed);
    } catch {
      return value;
    }
  }

  async log(event: string, data?: any, ctx?: AuditContext, severity: Severity = "info") {
    const evt: AuditEvent = {
      ts: Date.now(),
      event,
      severity,
      ctx,
      data: this.redact(data),
    };
    for (const s of this.sinks) {
      try { await s.write(evt); } catch { /* continue */ }
    }
  }
}

/** Singleton (optional) */
export const auditLog = new AuditLog();
