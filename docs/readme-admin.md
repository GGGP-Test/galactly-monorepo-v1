# Admin / Monitor — Artemis BV1

This doc explains how to use the **Admin Dashboard** and **Debug Console** to sanity-check your Buyers API in production.

---

## Quick open links (your repo)

- **Admin dashboard:**  
  https://gggp-test.github.io/galactly-monorepo-v1/docs/admin.html

- **Debug console:**  
  https://gggp-test.github.io/galactly-monorepo-v1/docs/debug.html

These pages remember the API base in your browser only.

**API base used throughout this doc:**
https://p01–animated-cellar–vz4ftkwrzdfs.code.run/api



If your API moves later, paste the new base into the **Base** field and click **Save**.

---

## Admin dashboard — what each part does

**Top bar**
- **Ping** → `GET /api/ping` (liveness)
- **Health** → `GET /api/health` (uptime/env + tiny catalog snapshot)
- **Reload catalog** → `POST /api/catalog/reload` (rebuild in-memory catalog)

**Left column**
- **Base** — API root or `/api` URL (we use the base above)  
- **Save** — persists Base locally; **Test** runs a quick ping
- **Find buyers** — `GET /api/leads/find-buyers` with Host (required) + City (optional)
- **Apply demo prefs** — `POST /api/prefs/upsert` with a safe demo persona:
  - city **San Diego**
  - general: `mids: true`, `near: true`
  - tags: `film, labels, food, beverage`
- **Auto-scroll logs** — keeps the live log pinned

**Live stream (center)**
- Periodic health checks (polled). Shows one-line summaries like  
  `Health -> 200 (catalog.total=3)`. If your network blocks SSE/polling, you’ll see
  “SSE: error”, but buttons still work.

**Last health snapshot (right)**
- Condensed JSON from the latest `GET /api/health`: service, uptime, `ALLOW_TIERS`, totals.

---

## Debug console — one-click API calls

**Classifier**
- `GET /classify?host=<host>&email=<email?>` (auto-fallback to `/api/classify`)

**Prefs**
- `GET /prefs?host=<host>`
- `POST /prefs/upsert` (demo persona noted above)

**Leads & Catalog**
- `GET /leads/find-buyers?host=<host>&city=<city?>&limit=<n?>`
- `GET /catalog`
- `GET /catalog/sample?limit=10`

**Places (optional)**
- `GET /places/search?q=<text>&city=<city?>&limit=<n?>`  
  Requires `GOOGLE_PLACES_API_KEY` on the API.

---

## REST endpoints (reference)

- **Ping** — `GET /api/ping`  
- **Health** — `GET /api/health`  
- **Status** — `GET /api/status` (quota/dev flags)  
- **Prefs** — `GET /api/prefs?host=<host>`, `POST /api/prefs/upsert`  
- **Leads** — `GET /api/leads/find-buyers`  
- **Catalog** — `GET /api/catalog`, `GET /api/catalog/sample?limit=10`, `POST /api/catalog/reload`  
- **Classifier** — `GET /api/classify?host=<host>&email=<email?>`  
- **Places (optional)** — `GET /api/places/search`

**API base used in all examples:** `https://p01--animated-cellar--vz4ftkwrzdfs.code.run/api`

---

## Env knobs (on the API host)

- `ALLOW_TIERS` = `A` | `AB` | `ABC` | `B` | `BC` | `C`  
  Controls which catalog tiers `/leads/find-buyers` considers. (You set **ABC**.)
- `MAX_RESULTS_FREE`, `MAX_RESULTS_PRO` — output caps
- `GOOGLE_PLACES_API_KEY` — enables `/places/search`
- `CACHE_TTL_S` — cache TTL seconds (default 300)
- Classifier: `CLASSIFY_DAILY_LIMIT` (default 20), `FETCH_TIMEOUT_MS` (default 7000), `MAX_FETCH_BYTES` (~1.5MB)
- CORS: `ALLOW_ORIGINS` should include `https://gggp-test.github.io` (for Pages)

---

## Custom domains

- **API moves?** Open Admin/Debug → paste new base (include `/api`) → **Save**.  
- **GitHub Pages on your domain?** Point DNS (CNAME) to Pages. No code changes needed.  
  Then use:
Then use: https://gggp-test.github.io/galactly-monorepo-v1/docs/admin.html
https://gggp-test.github.io/galactly-monorepo-v1/docs/debug.html

---

## Troubleshooting

- **SSE: error** — harmless; actions still work (Ping/Health/Find Buyers).
- **No leads returned** — check:
1) `ALLOW_TIERS` includes your catalog tiers;  
2) Catalog actually loaded (`GET /api/catalog`);  
3) Persona isn’t too strict (use **Apply demo prefs** and retry).
- **Places ok:false** — add `GOOGLE_PLACES_API_KEY` on the API host.
- **CORS blocked** — set `ALLOW_ORIGINS=https://gggp-test.github.io`.

---

## CLI smoke test (optional)

From repo root:
./scripts/smoke.sh


It calls health, ping, prefs (get/upsert), classify, leads, catalog, and places (if key set) against:

https://p01–animated-cellar–vz4ftkwrzdfs.code.run/api


---

## File map

docs/
admin.html
debug.html
readme-admin.md

