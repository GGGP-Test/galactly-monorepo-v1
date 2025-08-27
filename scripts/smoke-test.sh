#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-https://<YOUR-NF-ROUTE>.northflank.app}
TOKEN=${ADMIN_TOKEN:-CHANGE_ME}
USER=${USER_ID:-demo-user-1}


say(){ printf "\n=== %s ===\n" "$1"; }


say health
curl -fsS "$BASE/healthz" || true


say peek
curl -fsS "$BASE/api/v1/debug/peek" || true


say admin-all
curl -fsS -H "x-admin-token: $TOKEN" "$BASE/api/v1/admin/poll-now?source=all" || true


say gate
curl -fsS -H 'content-type: application/json' -H "x-galactly-user: $USER" -d '{"region":"US","email":"you@example.com","alerts":true}' "$BASE/api/v1/gate" || true


say leads
curl -fsS "$BASE/api/v1/leads" || true
