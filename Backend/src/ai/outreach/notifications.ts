// src/ai/outreach/notifications.ts

/**
 * Notifications
 * -------------
 * Unified notification layer for:
 *  - Email (SendGrid HTTP or SMTP via nodemailer if available)
 *  - Slack (Incoming webhook)
 *  - Webhooks (signed JSON POST)
 *  - CRM upserts (HubSpot, Pipedrive; minimal)
 *
 * Design:
 *  - Pluggable senders; each auto-disables if missing env keys
 *  - Simple token-based templates: {{company}}, {{leadScore}}, {{contact.fullName}}, etc.
 *  - Best-effort; failures bubble up with structured errors
 */

import crypto from "crypto";

type Dict = Record<string, any>;

export interface NotificationTargetEmail {
  kind: "email";
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  templateId?: string;       // SendGrid dynamic template (optional)
  templateData?: Dict;       // for SendGrid templates
  fromEmail?: string;        // override default
  fromName?: string;
}

export interface NotificationTargetSlack {
  kind: "slack";
  webhookUrl?: string;       // override env
  text?: string;
  blocks?: any[];
}

export interface NotificationTargetWebhook {
  kind: "webhook";
  url: string;
  payload: Dict;
  headers?: Dict;
  secret?: string;           // to sign payload (HMAC-SHA256)
}

export interface NotificationTargetHubSpot {
  kind: "hubspot";
  contact: {
    email: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
  };
  company?: {
    name?: string;
    domain?: string;
  };
  properties?: Dict;
}

export interface NotificationTargetPipedrive {
  kind: "pipedrive";
  person: {
    name: string;
    email?: string;
    phone?: string;
  };
  org?: { name?: string; address?: string };
  deal?: { title: string; value?: number; currency?: string; status?: "open" | "won" | "lost" };
}

export type NotificationTarget =
  | NotificationTargetEmail
  | NotificationTargetSlack
  | NotificationTargetWebhook
  | NotificationTargetHubSpot
  | NotificationTargetPipedrive;

export interface SendResult {
  ok: boolean;
  id?: string;
  provider?: string;
  error?: string;
}

// -------------------- Helpers --------------------

function render(template: string, data: Dict): string {
  // Minimal {{path}} replacer
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path) => {
    const keys = path.split(".");
    let v: any = data;
    for (const k of keys) v = v ? v[k] : undefined;
    if (v === undefined || v === null) return "";
    return String(v);
  });
}

async function httpJson(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

function choose<T>(...vals: (T | undefined)[]): T | undefined {
  for (const v of vals) if (v !== undefined) return v;
  return undefined;
}

// -------------------- Email Provider --------------------

class EmailSender {
  private fromEmail = process.env.EMAIL_FROM || "noreply@yourdomain.com";
  private fromName = process.env.EMAIL_FROM_NAME || "Lead AI";
  private sendgridKey = process.env.SENDGRID_API_KEY;

  private async sendWithSendGrid(payload: NotificationTargetEmail): Promise<SendResult> {
    if (!this.sendgridKey) return { ok: false, error: "SENDGRID_API_KEY missing" };
    const url = "https://api.sendgrid.com/v3/mail/send";
    const personalizations = [{
      to: (Array.isArray(payload.to) ? payload.to : [payload.to]).map((e) => ({ email: e })),
      cc: (payload.cc ?? []).map((e) => ({ email: e })),
      bcc: (payload.bcc ?? []).map((e) => ({ email: e })),
      dynamic_template_data: payload.templateData,
      subject: payload.subject,
    }];

    const body: any = {
      personalizations,
      from: { email: payload.fromEmail || this.fromEmail, name: payload.fromName || this.fromName },
      reply_to: { email: payload.fromEmail || this.fromEmail, name: payload.fromName || this.fromName },
      mail_settings: { sandbox_mode: { enable: false } },
    };

    if (payload.templateId) {
      body.template_id = payload.templateId;
    } else {
      body.content = payload.html
        ? [{ type: "text/html", value: payload.html }]
        : [{ type: "text/plain", value: payload.text || "" }];
    }

    const res = await httpJson(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.sendgridKey}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, provider: "sendgrid", error: txt || String(res.status) };
    }
    return { ok: true, provider: "sendgrid" };
  }

  private async sendWithSmtp(payload: NotificationTargetEmail): Promise<SendResult> {
    // Lazy require nodemailer to keep dependency optional
    let nodemailer: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      nodemailer = require("nodemailer");
    } catch {
      return { ok: false, error: "nodemailer not installed and SENDGRID_API_KEY not set" };
    }

    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const info = await transport.sendMail({
      from: `"${payload.fromName || this.fromName}" <${payload.fromEmail || this.fromEmail}>`,
      to: Array.isArray(payload.to) ? payload.to.join(",") : payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });

    return { ok: true, id: info?.messageId, provider: "smtp" };
  }

  async send(payload: NotificationTargetEmail): Promise<SendResult> {
    if (this.sendgridKey) return this.sendWithSendGrid(payload);
    return this.sendWithSmtp(payload);
  }
}

// -------------------- Slack Provider --------------------

class SlackSender {
  async send(payload: NotificationTargetSlack): Promise<SendResult> {
    const url = payload.webhookUrl || process.env.SLACK_WEBHOOK_URL;
    if (!url) return { ok: false, error: "Slack webhook URL missing" };

    const body = payload.blocks
      ? { blocks: payload.blocks, text: payload.text }
      : { text: payload.text || "(no text)" };

    const res = await httpJson(url, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, provider: "slack", error: t || String(res.status) };
    }
    return { ok: true, provider: "slack" };
  }
}

// -------------------- Webhook Sender --------------------

class WebhookSender {
  private sign(body: string, secret: string) {
    return crypto.createHmac("sha256", secret).update(body).digest("hex");
  }

  async send(payload: NotificationTargetWebhook): Promise<SendResult> {
    const body = JSON.stringify(payload.payload ?? {});
    const headers: Dict = {
      ...(payload.headers ?? {}),
    };
    if (payload.secret) {
      headers["X-Signature"] = this.sign(body, payload.secret);
      headers["X-Timestamp"] = Date.now().toString();
    }

    const res = await httpJson(payload.url, {
      method: "POST",
      headers,
      body,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, provider: "webhook", error: t || String(res.status) };
    }
    return { ok: true, provider: "webhook" };
  }
}

// -------------------- HubSpot Provider --------------------

class HubSpotSender {
  private token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  isEnabled() {
    return !!this.token;
  }

  private async upsertContact(contact: NotificationTargetHubSpot["contact"]) {
    const url = "https://api.hubapi.com/crm/v3/objects/contacts";
    const res = await httpJson(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({
        properties: {
          email: contact.email,
          firstname: contact.firstname,
          lastname: contact.lastname,
          phone: contact.phone,
        },
      }),
    });
    if (!res.ok) throw new Error(`HubSpot contact upsert failed: ${res.status}`);
    return res.json();
  }

  private async upsertCompany(company?: NotificationTargetHubSpot["company"]) {
    if (!company?.name) return undefined;
    const url = "https://api.hubapi.com/crm/v3/objects/companies";
    const res = await httpJson(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({
        properties: {
          name: company.name,
          domain: company.domain,
        },
      }),
    });
    if (!res.ok) throw new Error(`HubSpot company upsert failed: ${res.status}`);
    return res.json();
  }

  async send(payload: NotificationTargetHubSpot): Promise<SendResult> {
    if (!this.isEnabled()) return { ok: false, error: "HUBSPOT_PRIVATE_APP_TOKEN missing" };
    try {
      const contact = await this.upsertContact(payload.contact);
      const company = await this.upsertCompany(payload.company);
      // Optionally associate contact<->company here via associations API
      return { ok: true, provider: "hubspot", id: contact?.id };
    } catch (e: any) {
      return { ok: false, provider: "hubspot", error: e?.message || "hubspot error" };
    }
  }
}

// -------------------- Pipedrive Provider --------------------

class PipedriveSender {
  private token = process.env.PIPEDRIVE_API_TOKEN;
  private base = process.env.PIPEDRIVE_BASE_URL || "https://api.pipedrive.com/v1";

  isEnabled() {
    return !!this.token;
  }

  private async createOrg(name?: string) {
    if (!name) return undefined;
    const res = await httpJson(`${this.base}/organizations?api_token=${this.token}`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("pipedrive org create failed");
    return res.json();
  }

  private async createPerson(person: NotificationTargetPipedrive["person"], orgId?: number) {
    const res = await httpJson(`${this.base}/persons?api_token=${this.token}`, {
      method: "POST",
      body: JSON.stringify({
        name: person.name,
        email: person.email,
        phone: person.phone,
        org_id: orgId,
      }),
    });
    if (!res.ok) throw new Error("pipedrive person create failed");
    return res.json();
  }

  private async createDeal(deal: NonNullable<NotificationTargetPipedrive["deal"]>, orgId?: number, personId?: number) {
    const res = await httpJson(`${this.base}/deals?api_token=${this.token}`, {
      method: "POST",
      body: JSON.stringify({
        title: deal.title,
        value: deal.value,
        currency: deal.currency,
        status: deal.status || "open",
        org_id: orgId,
        person_id: personId,
      }),
    });
    if (!res.ok) throw new Error("pipedrive deal create failed");
    return res.json();
  }

  async send(payload: NotificationTargetPipedrive): Promise<SendResult> {
    if (!this.isEnabled()) return { ok: false, error: "PIPEDRIVE_API_TOKEN missing" };
    try {
      const orgResp = await this.createOrg(payload.org?.name);
      const orgId: number | undefined = orgResp?.data?.id;
      const personResp = await this.createPerson(payload.person, orgId);
      const personId: number | undefined = personResp?.data?.id;
      if (payload.deal) {
        const dealResp = await this.createDeal(payload.deal, orgId, personId);
        return { ok: true, provider: "pipedrive", id: dealResp?.data?.id?.toString() };
      }
      return { ok: true, provider: "pipedrive", id: personId?.toString() };
    } catch (e: any) {
      return { ok: false, provider: "pipedrive", error: e?.message || "pipedrive error" };
    }
  }
}

// -------------------- Facade --------------------

export class Notifications {
  private email = new EmailSender();
  private slack = new SlackSender();
  private webhook = new WebhookSender();
  private hubspot = new HubSpotSender();
  private pipedrive = new PipedriveSender();

  async send(target: NotificationTarget): Promise<SendResult> {
    switch (target.kind) {
      case "email":
        return this.email.send(target);
      case "slack":
        return this.slack.send(target);
      case "webhook":
        return this.webhook.send(target);
      case "hubspot":
        return this.hubspot.send(target);
      case "pipedrive":
        return this.pipedrive.send(target);
      default:
        return { ok: false, error: "unsupported target" };
    }
  }

  // Convenience: lead alert with lightweight templating
  async sendLeadAlert(opts: {
    to: string | string[];
    lead: {
      company: string;
      website?: string;
      domain?: string;
      score?: number;
      tier?: "hot" | "warm" | "skip";
      reasons?: string[];
      nextActions?: string[];
    };
    contact?: {
      fullName?: string;
      email?: string;
      title?: string;
      phone?: string;
    };
    template?: { subject: string; html?: string; text?: string };
  }): Promise<SendResult> {
    const subjectTpl = choose(opts.template?.subject, "🔥 New {{lead.tier}} lead: {{lead.company}} ({{lead.score}})");
    const htmlTpl =
      opts.template?.html ||
      `
        <h2>New {{lead.tier}} lead detected</h2>
        <p><strong>{{lead.company}}</strong> — Score: {{lead.score}}</p>
        {{#lead.website}}<p>Website: <a href="{{lead.website}}">{{lead.website}}</a></p>{{/lead.website}}
        {{#contact.fullName}}<p>Primary contact: {{contact.fullName}} ({{contact.title}}) — {{contact.email}}</p>{{/contact.fullName}}
        {{#lead.reasons}}<p>Why: {{lead.reasons}}</p>{{/lead.reasons}}
        {{#lead.nextActions}}<p>Next: {{lead.nextActions}}</p>{{/lead.nextActions}}
      `;
    const textTpl =
      opts.template?.text ||
      `New ${opts.lead.tier} lead: ${opts.lead.company} (score ${opts.lead.score}) ${opts.lead.website ? " — " + opts.lead.website : ""}`;

    // naive handlebars-ish sections
    const data = { lead: opts.lead, contact: opts.contact };
    const subject = render(subjectTpl!, data);
    const html = render(htmlTpl, {
      ...data,
      // allow arrays in reasons/nextActions to join
      lead: {
        ...opts.lead,
        reasons: (opts.lead.reasons ?? []).join(", "),
        nextActions: (opts.lead.nextActions ?? []).join(" • "),
      },
    });
    const text = render(textTpl, data);

    return this.email.send({ kind: "email", to: opts.to, subject, html, text });
  }

  async sendSlackLeadAlert(channelWebhookUrl: string | undefined, payload: {
    company: string;
    score?: number;
    tier?: string;
    domain?: string;
    reasons?: string[];
    nextActions?: string[];
  }): Promise<SendResult> {
    const text = `New ${payload.tier || "lead"}: ${payload.company} — score ${payload.score ?? "?"} ${payload.domain ? `(${payload.domain})` : ""}`;
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text } },
      ...(payload.reasons?.length
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: `*Why:* ${payload.reasons.join(", ")}` }] }]
        : []),
      ...(payload.nextActions?.length
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: `*Next:* ${payload.nextActions.join(" • ")}` }] }]
        : []),
    ];
    return this.slack.send({ kind: "slack", webhookUrl: channelWebhookUrl, text, blocks });
  }

  async emitSignedWebhook(url: string, event: string, payload: Dict, secret?: string): Promise<SendResult> {
    return this.webhook.send({ kind: "webhook", url, payload: { event, payload, ts: Date.now() }, secret });
  }

  // CRM helpers
  async upsertHubSpot(target: NotificationTargetHubSpot): Promise<SendResult> {
    return this.hubspot.send(target);
  }
  async upsertPipedrive(target: NotificationTargetPipedrive): Promise<SendResult> {
    return this.pipedrive.send(target);
  }
}

// -------------------- Example Usage (commented) --------------------
/*
const notifications = new Notifications();

// Email
await notifications.send({
  kind: "email",
  to: "team@yourdomain.com",
  subject: "Test",
  html: "<b>Hello</b>",
});

// Slack
await notifications.send({
  kind: "slack",
  text: "A lead is ready",
});

// Webhook
await notifications.emitSignedWebhook(
  "https://example.com/hook",
  "lead.created",
  { id: "lead_123", score: 87 },
  process.env.WEBHOOK_SECRET
);

// HubSpot
await notifications.upsertHubSpot({
  kind: "hubspot",
  contact: { email: "buyer@acme.com", firstname: "Buyer", lastname: "One" },
  company: { name: "ACME", domain: "acme.com" },
});

// Pipedrive
await notifications.upsertPipedrive({
  kind: "pipedrive",
  person: { name: "Buyer One", email: "buyer@acme.com" },
  org: { name: "ACME" },
  deal: { title: "Packaging RFQ — ACME", value: 12000, currency: "USD" },
});
*/
