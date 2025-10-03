# Artemis B v1 — API Map (quick reference)

Base URL examples:
- Local: `http://localhost:8787`
- Deployed: `https://YOUR-SUBDOMAIN.code.run`

All canonical endpoints are under `/api/*`. A plain `/ping` and `/healthz` also exist.

---

## Health

- `GET /healthz` → `ok` (text)
- `GET /api/ping` → `ok` (text)
- `GET /api/health/ping` → `{ pong, at }`
- `GET /api/health` → `{ ok, uptimeSec, env, catalog: { total, byTier, sample[] } }`

## Catalog (read-only)

- `GET /api/catalog`  
  → `{ total, byTier: {A,B,C}, topCities: [{city,count}], exampleHosts: [...] }`
- `GET /api/catalog/sample?limit=20`  
  → `{ items: [{host, name, tiers, tags, cityTags, segments}], total }`
- `POST /api/catalog/reload`  
  → `{ ok: true, reloaded: true }` (rebuilds in-memory cache from env/file)

## Persona / Prefs

- `GET /api/prefs/ping` → `{ pong, at }`
- `GET /api/prefs?host=acme.com`  
- `GET /api/prefs/:host`  
  → `{ ok, host, prefs, inboundOptIn, summary }`
- `POST /api/prefs/upsert`  
  Body (example, minimal):
  ```json
  {
    "host": "acme.com",
    "lineText": "acme.com — supplies packaging for brands in the U.S.",
    "productTags": ["labels","film"],
    "sectorHints": ["Food","Beverage"],
    "general": { "mids": true, "avoidBig": true, "near": true },
    "metrics": [{ "label": "Fast turnaround (≤ 2 weeks)", "value": 8 }],
    "targeting": { "city": "Austin" },
    "inboundOptIn": true
  }