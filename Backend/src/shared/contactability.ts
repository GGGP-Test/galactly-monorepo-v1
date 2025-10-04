// src/shared/contactability.ts
//
// Contactability detector (pure, fast, no deps).
// Input: a few HTML/text pages from a crawl.
// Output: normalized contactability score (0..100) + explain reasons.
//
// Typical use:
//   const summary = assessContactability([ { url, html }, ... ]);
//   summary.score  // 0..100
//   summary.flags  // booleans like hasForm, hasChatWidget, etc.
//   summary.reasons // short strings for logs/UI

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ContactPage = {
  url: string;
  html?: string;
  text?: string;
};

export type ContactFlags = {
  hasContactPage: boolean;
  hasForm: boolean;
  phoneCount: number;
  emailCount: number;
  hasEmailObfuscated: boolean;
  hasChatWidget: boolean;
  chatVendors: string[];
  hasWhatsApp: boolean;
  hasMessenger: boolean;
  hasTelegram: boolean;
  hasMap: boolean;
  hasAddress: boolean;
  hasHours: boolean;
};

export type Contactability = {
  score: number;         // 0..100
  reasons: string[];     // concise, <= 12 entries
  flags: ContactFlags;   // detail booleans/counters
};

const lc = (s: any) => String(s ?? "").toLowerCase();
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function safeText(html?: string, text?: string): string {
  if (text) return String(text);
  const h = String(html || "");
  return h.replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<!--[\s\S]*?-->/g, " ")
          .replace(/<\/?[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
}

/* ---------------------------- detectors -------------------------------- */

const RE_PHONE =
  /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)\d{3,4}[-.\s]?\d{3,4}\b/g; // broad, non-greedy
const RE_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const RE_EMAIL_OBF =
  /\b([a-z0-9._%+-]+)\s*(?:\(|\[)?\s*(?:at|@)\s*(?:\)|\])?\s*([a-z0-9.-]+)\s*(?:dot|\.)\s*([a-z]{2,})\b/i;

const RE_ADDRESS_HINT =
  /\b(suite|ste\.?|unit|floor|fl\.?|ave\.?|avenue|st\.?|street|road|rd\.?|blvd\.?|boulevard|drive|dr\.?|lane|ln\.?|pkwy|parkway)\b/i;

const RE_HOURS =
  /\b(hours|open\s*:\s*|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;

const CHAT_SNIPPETS: Record<string, RegExp> = {
  intercom: /widget\.intercom\.io|intercomSettings/i,
  crisp: /client\.crisp\.chat|crisp\.chat|crisp-sdk/i,
  drift: /js\.drift|driftt/i,
  tawk: /tawk\.to\/|embed\.tawk\.to/i,
  hubspot: /js\-embed\.hubspot|js\.hs\-forms|hs\-chat/i,
  zendesk: /zendesk\.com\/embeds|zE\(/i,
  livechat: /livechatinc\.com|cdn\.livechatinc/i,
  freshchat: /freshchat|wchat\.freshchat\.com/i,
};

function detectHasForm(html?: string): boolean {
  if (!html) return false;
  // Any form with an input that looks like contact intent
  const hasFormTag = /<form[\s>]/i.test(html);
  if (!hasFormTag) return false;
  const hasEmailField = /<input[^>]+type=["']?email/i.test(html);
  const hasMsgField = /(message|msg|comment|inquiry|enquiry|question)/i.test(html);
  const hasSubmit = /<button[^>]*>(?:send|submit|contact)/i.test(html) || /type=["']?submit/i.test(html);
  return hasEmailField || (hasMsgField && hasSubmit);
}

function detectPhones(txt: string): number {
  const m = txt.match(RE_PHONE);
  if (!m) return 0;
  // Guard against counting order numbers etc: keep ≤ 6 per page
  return Math.min(6, m.length);
}

function detectEmails(html?: string, txt?: string): { emails: number; obf: boolean } {
  const blob = (html || "") + " " + (txt || "");
  let emails = 0; let obf = false;
  const found = blob.match(new RegExp(RE_EMAIL, "gi"));
  if (found) emails += Math.min(found.length, 6);
  if (RE_EMAIL_OBF.test(blob)) { obf = true; emails += 1; }
  return { emails, obf };
}

function detectChatVendors(html?: string): string[] {
  if (!html) return [];
  const vendors: string[] = [];
  for (const [name, re] of Object.entries(CHAT_SNIPPETS)) {
    if (re.test(html)) vendors.push(name);
  }
  return vendors;
}

function detectMaps(html?: string): boolean {
  if (!html) return false;
  return /<iframe[^>]+maps\.google|google\.com\/maps|maps\.apple/i.test(html);
}

function isContactLikeUrl(u: string): boolean {
  const p = lc(u);
  return p.includes("/contact") || p.endsWith("/contact") || p.includes("/support") || p.includes("/help");
}

function detectWhatsApp(html?: string): boolean {
  return !!html && /(wa\.me\/|api\.whatsapp\.com\/send|whatsapp:\/\/)/i.test(html);
}
function detectMessenger(html?: string): boolean {
  return !!html && /(m\.me\/|facebook\.com\/messenger|fb\-customerchat)/i.test(html);
}
function detectTelegram(html?: string): boolean {
  return !!html && /(t\.me\/|telegram\.me\/|telegram\:\/\/)/i.test(html);
}

/* --------------------------- scoring model ----------------------------- */

function scoreFlags(flags: ContactFlags): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Contact page
  if (flags.hasContactPage) { score += 10; reasons.push("contact-page"); }

  // Forms & chat carry most weight (asynchronous + trackable)
  if (flags.hasForm) { score += 20; reasons.push("contact-form"); }
  if (flags.hasChatWidget) {
    const add = Math.min(25, 10 + 5 * Math.min(2, flags.chatVendors.length));
    score += add;
    reasons.push(`chat${flags.chatVendors.length ? ":" + flags.chatVendors.join(",") : ""}`);
  }

  // Direct lines
  if (flags.phoneCount > 0) { score += Math.min(18, 6 + 3 * Math.min(4, flags.phoneCount)); reasons.push(`phone×${flags.phoneCount}`); }
  if (flags.emailCount > 0) { score += Math.min(12, 4 + 2 * Math.min(4, flags.emailCount)); reasons.push(`email×${flags.emailCount}`); }
  if (flags.hasEmailObfuscated) { score += 2; reasons.push("email-obfuscated"); }

  // Messaging
  if (flags.hasWhatsApp) { score += 6; reasons.push("whatsapp"); }
  if (flags.hasMessenger) { score += 5; reasons.push("messenger"); }
  if (flags.hasTelegram) { score += 4; reasons.push("telegram"); }

  // Context info
  if (flags.hasHours) { score += 4; reasons.push("hours"); }
  if (flags.hasAddress) { score += 3; reasons.push("address"); }
  if (flags.hasMap) { score += 2; reasons.push("map"); }

  return { score: clamp(score), reasons };
}

/* ------------------------------ main ---------------------------------- */

/** Inspect a single page and produce partial flags. */
export function assessPageContactability(page: ContactPage): ContactFlags {
  const html = page.html || "";
  const text = safeText(page.html, page.text);

  const phoneCount = detectPhones(text);
  const em = detectEmails(html, text);
  const hasForm = detectHasForm(html);
  const vendors = detectChatVendors(html);
  const hasChatWidget = vendors.length > 0;
  const hasMap = detectMaps(html);
  const hasContactPage = isContactLikeUrl(page.url) || /contact us/i.test(text);
  const hasAddress = RE_ADDRESS_HINT.test(text);
  const hasHours = RE_HOURS.test(text);
  const hasWhatsApp = detectWhatsApp(html);
  const hasMessenger = detectMessenger(html);
  const hasTelegram = detectTelegram(html);

  return {
    hasContactPage,
    hasForm,
    phoneCount,
    emailCount: em.emails,
    hasEmailObfuscated: em.obf,
    hasChatWidget,
    chatVendors: vendors,
    hasWhatsApp,
    hasMessenger,
    hasTelegram,
    hasMap,
    hasAddress,
    hasHours,
  };
}

/** Merge flags across multiple pages (OR for booleans, sum for counts). */
export function mergeFlags(flags: ContactFlags[]): ContactFlags {
  const base: ContactFlags = {
    hasContactPage: false,
    hasForm: false,
    phoneCount: 0,
    emailCount: 0,
    hasEmailObfuscated: false,
    hasChatWidget: false,
    chatVendors: [],
    hasWhatsApp: false,
    hasMessenger: false,
    hasTelegram: false,
    hasMap: false,
    hasAddress: false,
    hasHours: false,
  };
  const vendors = new Set<string>();
  for (const f of flags) {
    base.hasContactPage ||= f.hasContactPage;
    base.hasForm ||= f.hasForm;
    base.phoneCount += Math.max(0, f.phoneCount || 0);
    base.emailCount += Math.max(0, f.emailCount || 0);
    base.hasEmailObfuscated ||= f.hasEmailObfuscated;
    base.hasChatWidget ||= f.hasChatWidget;
    (f.chatVendors || []).forEach(v => vendors.add(v));
    base.hasWhatsApp ||= f.hasWhatsApp;
    base.hasMessenger ||= f.hasMessenger;
    base.hasTelegram ||= f.hasTelegram;
    base.hasMap ||= f.hasMap;
    base.hasAddress ||= f.hasAddress;
    base.hasHours ||= f.hasHours;
  }
  base.phoneCount = Math.min(12, base.phoneCount);
  base.emailCount = Math.min(12, base.emailCount);
  base.chatVendors = Array.from(vendors);
  return base;
}

/** Primary entry: assess across pages and produce a 0..100 score + reasons. */
export function assessContactability(pages: ContactPage[]): Contactability {
  const per = (Array.isArray(pages) ? pages : []).map(assessPageContactability);
  const flags = mergeFlags(per);
  const { score, reasons } = scoreFlags(flags);
  return {
    score,
    reasons: reasons.slice(0, 12),
    flags,
  };
}

/** Convenience: quick summary line for logs. */
export function brief(contact: Contactability): string {
  const f = contact.flags;
  const bits = [
    f.hasForm ? "form" : "",
    f.hasChatWidget ? `chat(${f.chatVendors.join("+")})` : "",
    f.phoneCount ? `tel×${f.phoneCount}` : "",
    f.emailCount ? `mail×${f.emailCount}${f.hasEmailObfuscated ? "?" : ""}` : "",
    f.hasWhatsApp ? "wa" : "",
    f.hasMessenger ? "msgr" : "",
    f.hasHours ? "hours" : "",
  ].filter(Boolean);
  return `contactability ${contact.score} — ${bits.join(", ") || "none"}`;
}

export default {
  assessContactability,
  assessPageContactability,
  mergeFlags,
  brief,
};