// Robust smoke: proves outbound net, DNS, TLS, then hits /find-buyers with rich diagnostics.
// Run: node Backend/devtools/smoke/find-buyers.mjs

import { execSync } from "node:child_process";
import https from "node:https";

const API = process.env.API_URL || "";
const KEY = process.env.X_API_KEY || process.env.API_KEY || "";
const supplier = process.env.SUPPLIER || "peekpackaging.com";
const region = (process.env.REGION || "usca").toLowerCase();
const radiusMi = Number(process.env.RADIUS_MI || "50");
const persona = {
  offer: process.env.OFFER || "",
  solves: process.env.SOLVES || "",
  titles: process.env.TITLES || ""
};

function out(label, obj) {
  console.log(label + ":\n" + JSON.stringify(obj, null, 2) + "\n");
}

function sh(cmd) {
  try { return { ok: true, cmd, out: execSync(cmd, { stdio: "pipe" }).toString() }; }
  catch (e) { return { ok: false, cmd, code: e.status, out: e.stdout?.toString() || "", err: e.stderr?.toString() || String(e) }; }
}

(async () => {
  const summary = { ok: false, at: 0 };

  // Basic input guard
  if (!API.startsWith("https://")) {
    out("SMOKE", { ok:false, error:"API_URL missing/invalid", want:"https://<host>/api/v1/leads/find-buyers", API });
    process.exit(2);
  }

  // Derive host for DNS/TLS probes
  const host = new URL(API).host;

  // 1) Quick external reachability (proves internet)
  const ext = sh("curl -sS https://api.ipify.org");
  summary.internet = { ok: ext.ok, ip: ext.ok ? ext.out.trim() : undefined, err: ext.ok ? undefined : ext.err };

  // 2) DNS for your host
  const dig = sh(`getent ahosts ${host} || nslookup ${host} || host ${host}`);
  summary.dns = { ok: dig.ok, out: dig.out, err: dig.err };

  // 3) TLS handshake (proves cert/SNI)
  const tls = sh(`echo | openssl s_client -servername ${host} -connect ${host}:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates`);
  summary.tls = { ok: tls.ok, out: tls.out, err: tls.err };

  // 4) Healthz (if present)
  const health = sh(`curl -sS -I https://${host}/healthz || true`);
  summary.healthz = { out: health.out };

  // 5) Real POST to /find-buyers
  const body = { supplier, region, radiusMi, persona };
  const t0 = Date.now();
  let res, txt = "", json;

  try {
    res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(KEY ? { "x-api-key": KEY } : {})
      },
      body: JSON.stringify(body),
      // If you see CERT errors and need to confirm that’s the failure path, temporarily uncomment:
      // agent: new https.Agent({ rejectUnauthorized: false })
    });
    try { txt = await res.text(); } catch {}
    try { json = JSON.parse(txt); } catch { json = { raw: txt } }
    summary.call = {
      status: res.status,
      ms: Date.now() - t0,
      sent: body,
      headers: Object.fromEntries(res.headers.entries()),
      payload: json
    };
    summary.ok = res.ok;
  } catch (e) {
    summary.call = { error: String(e) };
  }

  out("SMOKE SUMMARY", summary);

  // Exit codes to make CI/Codex task red with a useful reason
  if (!summary.internet?.ok) process.exit(91);            // no outbound internet
  if (!summary.dns?.ok) process.exit(92);                 // DNS failure for host
  if (!summary.tls?.ok) process.exit(93);                 // TLS handshake failed
  if (!summary.call) process.exit(94);                    // fetch threw
  if ((summary.call.status || 0) >= 500) process.exit(95);// server error
  if ((summary.call.status || 0) === 404) process.exit(94);// route missing
  if ((summary.call.status || 0) === 400) process.exit(90);// bad request (payload)
  const created = Number(summary.call?.payload?.created || 0);
  const cands = Array.isArray(summary.call?.payload?.candidates) ? summary.call.payload.candidates.length : 0;
  if (created === 0 && cands === 0) process.exit(10);     // ok=true but empty → logic block
  process.exit(0);
})();