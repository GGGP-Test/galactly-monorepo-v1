// Node 18+/20+. One-file harness that hits /api/v1/leads/find-buyers and prints WHY it's empty/failing.
const API = process.env.API_URL || "";
const KEY = process.env.API_KEY || process.env.X_API_KEY || "";
const domain = process.env.SUPPLIER || process.argv[2] || "";
const region = (process.env.REGION || "usca").toLowerCase();
const radiusMi = Number(process.env.RADIUS_MI || "50");
const verbose = (process.env.VERBOSE || "").toLowerCase() === "true";

if (!API || !API.startsWith("http")) {
  console.error("ERR: set API_URL to https://<northflank>/api/v1/leads/find-buyers");
  process.exit(2);
}
if (!domain) {
  console.error("ERR: provide supplier domain via SUPPLIER env or argv[2] (e.g. peekpackaging.com)");
  process.exit(2);
}

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

(async () => {
  const t0 = Date.now();
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(KEY ? { "x-api-key": KEY } : {})
    },
    body: JSON.stringify(body)
  }).catch(e => ({ ok:false, status:0, headers:{ get:()=>"" }, text: async()=>String(e) }));

  const dt = Date.now() - t0;
  let text = "";
  try { text = await res.text(); } catch {}
  const isJSON = (res.headers?.get?.("content-type") || "").includes("application/json");
  const payload = isJSON ? tryJSON(text) : { raw: text };

  const summary = {
    status: res.status || 0,
    ms: dt,
    api: API,
    supplier: domain,
    sent: body,
    received: payload
  };

  console.log("=== BUYERS SMOKE ===");
  console.log(JSON.stringify(summary, null, 2));

  // Exit codes so Codex can branch:
  if ((res.status || 0) >= 500) process.exit(5);   // server error
  if ((res.status || 0) === 404) process.exit(4);  // route missing
  if ((res.status || 0) === 400) process.exit(3);  // bad request

  // ok but empty → signal logic hole (not transport)
  const created = Number(payload?.created || 0);
  const cands = Array.isArray(payload?.candidates) ? payload.candidates.length : 0;
  if (created === 0 && cands === 0) {
    if (verbose) console.error("NOTE: ok=true but no candidates (discovery disabled / persona empty / filters wiped all).");
    process.exit(10);
  }

  function tryJSON(t) { try { return JSON.parse(t); } catch { return { parseError: true, raw: t }; } }
})();
