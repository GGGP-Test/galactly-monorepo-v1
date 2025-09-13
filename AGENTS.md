# Codex rules for this repo

- Use Node 20.
- When you touch backend code:
  - Install deps: `cd backend && npm ci`.
  - Run smoke: `node devtools/smoke/find-buyers.mjs peekpackaging.com`.
  - Treat exit codes 3/4/5 as failures; 10 as logic-empty (open a PR fixing the cause).
- Never store PII; only hashed contacts go into BLEED store.
