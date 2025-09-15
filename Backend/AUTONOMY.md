# AUTONOMY — Company Strategy & Guardrails

## Mission
Generate live B2B leads for **US packaging suppliers** (distributors & converters) with evidence trails.

## What counts as a “lead”
- Company operates in the **United States**
- Domain appears active & business-grade (no social/link aggregators)
- Relevant: packaging distributors, corrugated, films, tapes, void fill, cold-chain packaging, protective packaging
- Exclude: **sam.gov**, RFP portals, agencies, job boards, marketplaces only, social profiles

## Freshness
- Prefer sources indexed/updated in the **last 90 days** if available

## Success criteria (smoke)
- Each run must return **≥ 3 candidates** where `source != "DEMO_SOURCE"`
- Provide **evidence** per lead (URL/title/query)

## Cost policy
- Use **OpenRouter free/cheap models**; **≤1 LLM call per supplier**; **≤600 tokens** response
- Prefer rules/regex/heuristics over LLM where possible

## Edit policy (allowlist)
The bot may only modify these paths without human approval:
- backend/src/buyers/discovery.ts
- backend/src/buyers/pipeline.ts
- backend/src/routes/leads.ts
- backend/src/connectors/google.ts
- backend/src/connectors/kompass.ts
- backend/src/connectors/thomasnet.ts

## Deploy/runtime
- Runtime: Northflank Node 20 service (env: `NF_API_URL`, `NF_API_KEY`)
- API route: `POST /api/v1/leads/find-buyers`

## Guardrails
- Do **not** reintroduce `app.options(...)`; keep `app.use(cors(...))`
- Never print or hardcode secrets
- If sources fail, return demo leads **and** log the failure as evidence
