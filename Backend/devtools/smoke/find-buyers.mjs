// Node 18+/20+. Verbose smoke for /api/v1/leads/find-buyers.
// Prints clear diagnostics for network, health, and response reasons.

import dns from "node:dns/promises";
import { URL } from "node:url";

// ────────────────────────────────────────────────────────────────────────────────
// Env / args
const API = process.env.API_URL || "";
const KEY = process.env.API_KEY || process.env.X_API_KEY || "";
const supplier = process.env.SUPPLIER || process.argv[2] || "";
const region = (process.env.REGION || "usca").toLowerCase();
const radiusMi = Number(process.env.RADIUS_MI || "50");
const verbose = (process.env.VERBOSE || "true").toLowerCase() === "true";

const persona = {
  offer: process.env.OFFER || "",
  solves: process.env.SOLVES || "",
  titles: process.env.TITLES || "",
};

// ────────────────────────────────────────────────────────────────────────────────
// Helpers
const t0 = Date.now();
const timems = () => Date.now() - t0;

function bail(code, msg, extra = {}) {
  const out = { ok: false, at: timems(), error: msg, ...extra };
  console.error(JSON.stringify(out, null, 2));
  process.exit(code);
}

function safeJSON(text) {
  try { return JSON.parse(text); } catch { return { parseError: true, raw: text }; }
}

// ────────────────────────────────────────────────────────────────────────────────
// Validate input
if (!API || !API.startsWith("http")) {
  bail(2, "Missing/invalid API_URL (e.g. https://<northflank>/api/v1/leads/find-buyers)", { API });
}
if (!supplier) {
  bail(2, "Missing SUPPLIER (env) or argv[2], e.g. peekpackaging.com");
}

let postURL;
try {
  const u = new URL(API);
  if (!u.pathname.endsWith("/api/v1/leads/find-buyers")) {
    // be forgiving: append the route if user gave base origin
    if (u.pathname === "/" || u.pathname === "") u.pathname = "/api/v1/leads/find-buyers";
  }
  // tack on debug=1 so the server can include reasons if it supports it
  u.searchParams.set("debug", "1");
  postURL = u.toString();
} catch (e) {
  bail(2, "API_URL is not a valid URL", { API, error: String(e) });
}

// ────────────────────────────────────────────────────────────────────────────────
// DNS diagnostics
let dnsInfo = { host: "", addrs: [] };
try {
  const host = new URL(postURL).hostname;
  const addrs = await dns.lookup(host, { all: true });
  dnsInfo = { host, addrs };
} catch (e) {
  if (verbose) console.error("DNS lookup failed:", String(e));
}

// Optional health check on /healthz
let health = { ok: false, status: 0 };
try {
  const base = new URL(postURL); base.pathname = "/healthz"; base.search = "";
  const r = await fetch(base.toString(), { method: "GET" });
  health = { ok: r.ok, status: r.status };
} catch (e) {
  health = { ok: false, status: 0 };
}

// ────────────────────────────────────────────────────────────────────────────────
// Build request body
const body = {
  supplier,
  region,
  radiusMi,
  persona,            // let server decide if empty persona is ok
};

// POST find-buyers
let res, text = "", ctype = "";
try {
  res = await fetch(postURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(KEY ? { "x-api-key": KEY } : {}),
    },
    body: JSON.stringify(body),
  });
  ctype = res.headers?.get?.("content-type") || "";
  text = await res.text();
} catch (e) {
  // Network fail → status 0
  bail(7, "fetch failed (network/SSL/firewall)", {
    postURL, dnsInfo, health, detail: String(e),
    hint: "In Codex environment, ensure Agent internet access = On.",
  });
}

const payload = ctype.includes("application/json") ? safeJSON(text) : { raw: text };

const summary = {
  api: postURL,
  supplier,
  sent: body,
  dns: dnsInfo,
  health,
  http: { status: res.status, ok: res.ok, contentType: ctype },
  received: payload,
  ms: timems(),
};

console.log("=== BUYERS SMOKE ===");
console.log(JSON.stringify(summary, null, 2));

// Exit codes (so CI/Codex can gate on them)
if (res.status >= 500) process.exit(5);              // server error
if (res.status === 404) process.exit(4);             // route missing
if (res.status === 400) process.exit(3);             // bad request (missing domain, etc.)

// ok but empty → flag logic hole (helps us differentiate transport vs business logic)
const created = Number(payload?.created || 0);
const cands = Array.isArray(payload?.candidates) ? payload.candidates.length : 0;
if (created === 0 && cands === 0) {
  // Prefer the server to tell us WHY in payload.note / payload.reasons if debug=1 is honored.
  process.exit(10);
}

process.exit(0);