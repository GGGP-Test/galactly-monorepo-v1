// scripts/refresh.mjs
// Periodically refresh a small set of hosts using /api/scores/explain
// No deps. Node 18+ (global fetch).
//
// Env (all optional):
//   API_BASE=https://p01--animated-cellar--vz4ftkwrzdfs.code.run/api
//   ADMIN_TOKEN=...         (only if you locked admin endpoints; not required here)
//   REFRESH_HOSTS=foo.com,bar.com   (comma list; else we pull from /api/catalog/sample)
//   REFRESH_LIMIT=50         (max hosts to refresh from catalog/sample)
//   CONCURRENCY=3            (parallelism)
//
// Output: JSON Lines to stdout + human summary lines.

const API_BASE = (process.env.API_BASE || "https://p01--animated-cellar--vz4ftkwrzdfs.code.run/api").replace(/\/+$/,"");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const REFRESH_LIMIT = Math.max(1, Math.min(200, Number(process.env.REFRESH_LIMIT || 50)));
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CONCURRENCY || 3)));

function hdrs() {
  const h = { "Content-Type": "application/json" };
  if (ADMIN_TOKEN) (h)["x-admin-token"] = ADMIN_TOKEN;
  return h;
}

async function getSampleHosts() {
  const res = await fetch(`${API_BASE}/catalog/sample?limit=${REFRESH_LIMIT}`, { headers: hdrs() });
  if (!res.ok) return [];
  const j = await res.json().catch(() => ({}));
  const items = Array.isArray(j?.items) ? j.items : [];
  return items.map(it => String(it?.host || "")).filter(Boolean);
}

function unique(arr) { return Array.from(new Set(arr.filter(Boolean))); }

async function explainOne(host) {
  const u = new URL(`${API_BASE}/scores/explain`);
  u.searchParams.set("host", host);
  const t0 = Date.now();
  const res = await fetch(u.toString(), { headers: hdrs() });
  const txt = await res.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  const ms = Date.now() - t0;
  return {
    ok: res.ok && j?.ok === true,
    status: res.status,
    host,
    band: j?.band || null,
    score: j?.score ?? null,
    reasons: j?.reasons || [],
    ms,
    url: j?.url || null,
    http: j?.http || null,
    at: j?.at || new Date().toISOString(),
  };
}

async function run() {
  const fromEnv = String(process.env.REFRESH_HOSTS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  const hosts = unique(fromEnv.length ? fromEnv : await getSampleHosts());
  if (!hosts.length) {
    console.log(`# refresh: no hosts found (API_BASE=${API_BASE})`);
    process.exit(0);
  }

  console.log(`# refresh: ${hosts.length} host(s), concurrency=${CONCURRENCY}`);

  const q = hosts.slice(); // simple FIFO
  let active = 0, done = 0, hot = 0, warm = 0;

  const next = async () => {
    const host = q.shift();
    if (!host) return;
    active++;
    try {
      const r = await explainOne(host);
      // JSONL line
      console.log(JSON.stringify({ type: "score", ...r }));
      // tiny human line
      const tag =
        r.band === "HOT" ? (++hot, "🔥") :
        r.band === "WARM" ? (++warm, "🌶️") : "•";
      console.log(`${tag} ${host} -> ${r.band || "?"} ${r.score ?? "?"} (${r.ms}ms)`);
    } catch (e) {
      console.log(JSON.stringify({ type: "error", host, error: String(e) }));
      console.log(`× ${host} -> error`);
    } finally {
      active--; done++;
      if (q.length) next();
    }
  };

  // kick off workers
  const workers = Math.min(CONCURRENCY, hosts.length);
  for (let i = 0; i < workers; i++) next();

  // wait until drained
  await new Promise(resolve => {
    const id = setInterval(() => {
      if (active === 0 && q.length === 0) { clearInterval(id); resolve(null); }
    }, 100);
  });

  console.log(`# done: total=${done} hot=${hot} warm=${warm}`);
}

run().catch(e => {
  console.error("refresh failed:", e);
  process.exit(1);
});