# AUTONOMY — Company Strategy & Guardrails

## Mission
Generate live B2B leads for **US & Canada packaging suppliers** (distributors & converters) with evidence trails.

## Lead definition
- Operates in **US or Canada**
- Active business domain (no social-only / link hubs)
- Relevant: packaging distributors, corrugated, films, tapes, shrink/stretch, void fill, cold-chain packaging, protective packaging
- Exclude: **sam.gov**, RFP portals, agencies, job boards, marketplaces-only, social profiles

## Geo preference
- Start near the supplier's detected HQ/city (from website signals); widen to state/region → country if few results.

## Freshness
- Prefer sources updated in the **last 90 days** when available.

## Success criteria (smoke)
- Each run must return **≥ 3 candidates** where `source != "DEMO_SOURCE"`
- Provide **evidence** per lead (URL/title/query)

## Cost policy
- Use **OpenRouter free/cheap models**; **≤1 LLM call per supplier**; **≤600 tokens** response
- Prefer regex/rules/heuristics over LLM where possible

## Edit policy (allowlist)
Bot may modify only these paths without human approval:
- Backend/src/buyers/discovery.ts
- Backend/src/buyers/pipeline.ts
- Backend/src/routes/leads.ts
- Backend/src/connectors/google.ts
- Backend/src/connectors/kompass.ts
- Backend/src/connectors/thomasnet.ts

## Deploy/runtime
- Runtime: Northflank Node 20 service (env: `NF_API_URL`, `NF_API_KEY`)
- API route: `POST /api/v1/leads/find-buyers`

## Guardrails
- Do **not** reintroduce `app.options(...)`; keep `app.use(cors(...))`
- Never print or hardcode secrets
- If sources fail, return demo leads **and** log the failure as evidence
