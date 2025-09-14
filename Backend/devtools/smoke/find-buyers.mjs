// Node 20+. One-file diagnostic for /api/v1/leads/find-buyers
import dns from "node:dns/promises";
import { URL } from "node:url";

const API = process.env.API_URL || "";
const KEY = process.env.API_KEY || process.env.X_API_KEY || "";
const domain = (process.env.SUPPLIER || process.argv[2] || "").trim();
const region = (process.env.REGION || "usca").toLowerCase();
const radiusMi = Number(process.env.RADIUS_MI || "50");
const verbose = (process.env.VERBOSE || "").toLowerCase() === "true";
const insecure = (process.env.INSECURE || "") === "1";

if (!API || !API.startsWith("http")) {
  console.error(JSON.stringify({ ok:false, err:"set API_URL to https://<nf-host>/api/v1/leads/find-buyers" }, null, 2));
  process.exit(2);
}
if (!domain) {
  console.error(JSON.stringify({ ok:false, err:"set SUPPLIER or pass argv[2] (e.g. peekpackaging.com)" }, null, 2));
  process.exit(2);
}

if (insecure) {
  // allow TLS to self-signed if you ever need to debug proxies
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const u = new URL(API);
const body = {
  supplier: domain,
  region,
  radiusMi,
  persona: {
    offer: process.env.OFFER || "",
    solves: process.env.SOLVES || "",
    titles: process.env.TITLES || ""
  }
};

const out = { ok:false, at: 0, api: API, host: u.host, env: { region, radiusMi, domain }, steps:{} };

try {
  // DNS
  const addrs = await dns.lookup(u.hostname, { all:true }).catch(e => ({ error:String(e) }));
  out.steps.dns = addrs;

  // /healthz
  const healthzURL = `${u.origin}/healthz`;
  const h = await fetch(healthzURL).catch(e => ({ ok:false, status:0, text: async()=>String(e), headers:new Headers() }));
  out.steps.healthz = {
    status: h.status || 0,
    ct: (h.headers?.get?.("content-type") || ""),
    body: await (h.text?.() ?? Promise.resolve(""))
  };

  // POST
  const t0 = Date.now();
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(KEY ? { "x-api-key": KEY } : {})
    },
    body: JSON.stringify(body)
  }).catch(e => ({ ok:false, status:0, headers:new Headers(), text: async()=>String(e) }));
  const ms = Date.now() - t0;
  const text = await (res.text?.() ?? Promise.resolve(""));
  const isJSON = (res.headers?.get?.("content-type") || "").includes("application/json");
  const payload = isJSON ? safeJSON(text) : { raw:text };

  out.steps.call = { status: res.status || 0, ms, sent: body, received: payload };

  // Verdict
  if ((res.status || 0) >= 500) { out.ok = false; out.at = 500; }
  else if ((res.status || 0) === 404) { out.ok = false; out.at = 404; }
  else if ((res.status || 0) === 400) { out.ok = false; out.at = 400; }
  else {
    const created = Number(payload?.created || 0);
    const cands = Array.isArray(payload?.candidates) ? payload.candidates.length : 0;
    out.ok = true;
    out.at = (created === 0 && cands === 0) ? 10 : 200;
    if (out.at === 10 && verbose) {
      out.note = "ok=true but empty (discovery disabled / persona empty / filters removed everything)";
    }
  }
} catch (e) {
  out.ok = false;
  out.err = String(e);
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);

function safeJSON(t) { try { return JSON.parse(t); } catch { return { parseError:true, raw:t }; } }