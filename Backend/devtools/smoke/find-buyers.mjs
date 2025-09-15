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
  let res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(KEY ? { "x-api-key": KEY } : {})
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return bail(0, { error: String(e) }, "TypeError: fetch failed");
  }

  const dt = Date.now() - t0;
  const isJSON = (res.headers?.get?.("content-type") || "").includes("application/json");
  const text = await res.text();
  const payload = isJSON ? tryJSON(text) : { raw: text };

  const summary = {
    ok: res.ok,
    at: res.status,
    api: API,
    host: safeHost(API),
    env: { region, radiusMi, domain },
    steps: {
      // keep these fields so Actions logs are stable across runs
      call: {
        status: res.status,
        ms: dt,
        sent: body,
        received: payload
      }
    }
  };

  // Print machine-readable log for the Action artifact:
  console.log(JSON.stringify(summary, null, 2));

  // exit codes (for CI)
  if (res.status >= 500) process.exit(5);
  if (res.status === 404) process.exit(4);
  if (res.status === 400) process.exit(3);

  const created = Number(payload?.created || 0);
  const cands = Array.isArray(payload?.candidates) ? payload.candidates.length : 0;
  if (created === 0 && cands === 0) {
    if (verbose) console.error("NOTE: ok=true but no candidates (discovery disabled / persona empty / filters wiped all).");
    process.exit(10);
  }
  process.exit(0);

  function tryJSON(t) { try { return JSON.parse(t); } catch { return { parseError: true, raw: t }; } }
  function safeHost(u) { try { return new URL(u).host; } catch { return ""; } }
})();

function bail(code, extra, hint) {
  const out = { ok: false, at: code, ...extra };
  if (hint) out.hint = hint;
  console.log(JSON.stringify(out, null, 2));
  process.exit(code || 1);
}