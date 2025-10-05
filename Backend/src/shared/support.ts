// src/shared/support.ts
//
// Artemis-B v1 — Support / SLA signal
// Pure heuristics over raw site text: live chat, phone/email presence,
// hours (24/7, business hours), stated response time, returns/RMA clarity,
// help center/FAQ/status page. No network, no deps.
// Emits a 0..1 score + compact reasons.
//
// Exports:
//   extractSupport(text: string): SupportSignal
//   summarizeSupport(sig: SupportSignal, maxParts=5): string
//
// Safe for CJS/ESM.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SupportSignal {
  hasLiveChat: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  contactPage: boolean;
  hours24x7: boolean;
  hoursMention: string | null;
  statedResponseHrs: number | null; // e.g., "reply within 24 hours" -> 24
  returnsPolicy: boolean;           // returns/refund/RMA clarity present
  kbOrFaq: boolean;                 // help center / knowledge base / FAQ
  statusPage: boolean;              // status.* or "status page"
  supportScore: number;             // 0..1
  reasons: string[];                // compact why (<= 8 items)
}

/* ------------------------------- utils ----------------------------------- */

const lc = (v: any) => String(v ?? "").toLowerCase();
const normWS = (s: string) => s.replace(/\s+/g, " ").trim();
function sat(n: number, capMax: number) { return capMax > 0 ? Math.max(0, Math.min(capMax, n)) / capMax : 0; }
function uniq(parts: string[], cap = 8) {
  const s = new Set<string>(); const out: string[] = [];
  for (const p of parts) { const t = p.trim(); if (t && !s.has(t)) { s.add(t); out.push(t); if (out.length >= cap) break; } }
  return out;
}

function parseHoursWindow(text: string): { is247: boolean; mention: string | null } {
  const t = lc(text);
  if (/(24\/?7|24x7|24\s*hours\s*(?:a\s*day)?|around the clock)/i.test(t)) {
    return { is247: true, mention: "24/7" };
  }
  // e.g., "Mon–Fri 9am–6pm", "Monday to Friday, 8:00-17:00 PT"
  const m = text.match(/\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b.*?\b(\d{1,2}(:\d{2})?\s*(?:am|pm|AM|PM)?)[\s–-]+(\d{1,2}(:\d{2})?\s*(?:am|pm|AM|PM)?)/);
  if (m) return { is247: false, mention: m[0].trim() };
  return { is247: false, mention: null };
}

function parseResponseTimeHours(text: string): number | null {
  // "reply within 24 hours", "response time: 2-4 business hours"
  const resp =
    text.match(/\b(?:reply|respond|response(?: time)?|we aim to reply)\s*(?:within|in|:)?\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*(business\s*)?hours?\b/i) ||
    text.match(/\b(?:reply|respond)\s*(?:within|in|:)?\s*(\d{1,3})\s*days?\b/i);
  if (!resp) return null;
  if (resp[2]) {
    // range -> take upper bound
    const hi = Number(resp[2]); return Number.isFinite(hi) ? hi : null;
  }
  const n = Number(resp[1]);
  if (Number.isFinite(n)) return /days?/i.test(resp[0]) ? n * 24 : n;
  return null;
}

function hasPhone(text: string): boolean {
  // crude US/EU-ish patterns + "call us"
  return /\bcall\s+us\b/i.test(text) ||
         /\b\+?\d{1,3}[\s().-]?\d{2,4}[\s().-]?\d{3}[\s().-]?\d{3,4}\b/.test(text);
}
function hasEmail(text: string): boolean {
  return /(mailto:|support@|help@|care@|service@|customersupport@|contact@)/i.test(text);
}
function hasLiveChat(text: string): boolean {
  return /\b(live chat|chat now|chat with us|start chat|agent online)\b/i.test(text) ||
         /\b(intercom|drift|crisp chat|tawk\.to|zendesk chat|livechatinc)\b/i.test(text);
}
function hasContactPage(text: string): boolean {
  return /\b(contact\s+us|customer support|get in touch)\b/i.test(text);
}
function hasKB(text: string): boolean {
  return /\b(help center|knowledge base|kb\.|documentation|docs|faq|frequently asked questions)\b/i.test(text);
}
function hasStatus(text: string): boolean {
  return /\bstatus\s?page\b/i.test(text) || /\bstatus\.[a-z0-9.-]+\b/i.test(text);
}
function hasReturns(text: string): boolean {
  return /\b(returns?|refunds?|rma|return merchandise authorization|money[-\s]?back)\b/i.test(text);
}

/* --------------------------------- core ---------------------------------- */

export function extractSupport(text: string): SupportSignal {
  const raw = normWS(String(text || ""));
  const t = lc(raw);

  const phone = hasPhone(raw);
  const email = hasEmail(t);
  const chat = hasLiveChat(t);
  const contact = hasContactPage(t);

  const { is247, mention } = parseHoursWindow(raw);
  const respH = parseResponseTimeHours(raw);

  const kb = hasKB(t);
  const status = hasStatus(t);
  const returns = hasReturns(t);

  // Scoring (cap = 8.0):
  // chat 2.0, phone 1.5, email 1.0, hours 1.0 (24/7 -> 1.5),
  // response time 1.0 (≤24h -> full, ≤72h -> 0.6), returns 0.8, KB/FAQ 0.5, status 0.2, contact page 0.2
  let pts = 0;
  if (chat) pts += 2.0;
  if (phone) pts += 1.5;
  if (email) pts += 1.0;
  if (is247) pts += 1.5;
  else if (mention) pts += 1.0;

  if (respH != null) {
    if (respH <= 24) pts += 1.0;
    else if (respH <= 72) pts += 0.6;
    else pts += 0.3;
  }

  if (returns) pts += 0.8;
  if (kb) pts += 0.5;
  if (status) pts += 0.2;
  if (contact) pts += 0.2;

  const supportScore = sat(pts, 8);

  const reasons = uniq([
    chat ? "chat" : "",
    phone ? "phone" : "",
    email ? "email" : "",
    is247 ? "24/7" : (mention ? `hours:${mention}` : ""),
    respH != null ? `resp:${respH}h` : "",
    returns ? "returns" : "",
    kb ? "kb/faq" : "",
    status ? "status" : "",
    contact ? "contact" : "",
    `score:${Math.round(supportScore * 100)}%`,
  ]);

  return {
    hasLiveChat: chat,
    hasPhone: phone,
    hasEmail: email,
    contactPage: contact,
    hours24x7: is247,
    hoursMention: mention,
    statedResponseHrs: respH,
    returnsPolicy: returns,
    kbOrFaq: kb,
    statusPage: status,
    supportScore,
    reasons,
  };
}

export function summarizeSupport(sig: SupportSignal, maxParts = 5): string {
  if (!sig) return "no support data";
  const bits: string[] = [];
  if (sig.hasLiveChat) bits.push("chat");
  if (sig.hasPhone) bits.push("phone");
  if (sig.hasEmail) bits.push("email");
  if (sig.hours24x7) bits.push("24/7");
  else if (sig.hoursMention) bits.push(sig.hoursMention);
  if (sig.statedResponseHrs != null) bits.push(`${sig.statedResponseHrs}h resp`);
  if (sig.returnsPolicy) bits.push("returns");
  if (sig.kbOrFaq) bits.push("kb/faq");
  if (sig.statusPage) bits.push("status");
  const list = bits.slice(0, maxParts).join(" • ");
  return `${Math.round((sig.supportScore || 0) * 100)}% support — ${list || "minimal signals"}`;
}

export default { extractSupport, summarizeSupport };