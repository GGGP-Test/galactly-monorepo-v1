#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-https://galactly-api-docker.onrender.com}"
TOKEN="${ADMIN_TOKEN:-CHANGE_ME}"
USER="${USER_ID:-demo-user-1}"


say(){ printf "
=== %s ===
" "$1"; }


say health
curl -fsS "$BASE/healthz" || true


say peek
curl -fsS "$BASE/api/v1/debug/peek" || true


say admin-all
curl -fsS -H "x-admin-token: $TOKEN" "$BASE/api/v1/admin/poll-now?source=all" || true


say gate
curl -fsS -H 'content-type: application/json' -H "x-galactly-user: $USER" -d '{"region":"US","email":"you@example.com","alerts":true}' "$BASE/api/v1/gate" || true


say status
curl -fsS -H "x-galactly-user: $USER" "$BASE/api/v1/status" || true


say leads
curl -fsS "$BASE/api/v1/leads" || true
