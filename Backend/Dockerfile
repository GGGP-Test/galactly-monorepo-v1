# Robust Backend build/run for Northflank
FROM node:20-alpine

ENV NODE_ENV=production \
    npm_config_loglevel=warn

# Tools needed for native addons and curl/bash
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && apk add --no-cache bash curl

WORKDIR /app
COPY . .

# ---- Detect the app directory that contains package.json (prefer Backend) ----
# Writes *only* the absolute path to /app/.appdir
RUN set -eux; \
  CAND=""; \
  # 1) Prefer a conventional folder if it has package.json
  for d in Backend backend api server app; do \
    if [ -d "$d" ] && [ -f "$d/package.json" ]; then CAND="/app/$d"; break; fi; \
  done; \
  # 2) Otherwise, grab the first package.json under 3 levels deep
  if [ -z "$CAND" ]; then \
    CAND="$(dirname "$(find . -maxdepth 3 -type f -name package.json | head -n1)")"; \
    # normalize to absolute
    CAND="/app/${CAND#./}"; \
  fi; \
  # Guardrails: verify we found something useful
  if [ -z "$CAND" ] || [ ! -f "$CAND/package.json" ]; then \
    echo "❌ Could not locate an app folder with package.json" >&2; exit 1; \
  fi; \
  echo "$CAND" > /app/.appdir; \
  printf "✅ Using app dir: %s\n" "$CAND"

# ---- Install dependencies robustly in that app dir ----
RUN set -eux; \
  APP_DIR="$(cat /app/.appdir)"; \
  cd "$APP_DIR"; \
  # final sanity check
  test -f package.json || (echo "❌ No package.json in $APP_DIR" >&2; exit 1); \
  # if a lockfile exists, prefer npm ci; otherwise use npm install
  if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
    echo "Using npm ci"; \
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund --legacy-peer-deps; \
  else \
    echo "No lockfile – using npm install"; \
    npm install --no-audit --no-fund --legacy-peer-deps; \
  fi; \
  # remove build toolchain; runtime is pure Node
  cd /app && apk del .build-deps

# ---- Run the API with tsx (dev-time TypeScript runner) ----
ENV PORT=8787
EXPOSE 8787

# Start script: cd into app dir and run src/index.ts with tsx
CMD ["/bin/sh", "-lc", "APP_DIR=$(cat /app/.appdir) && cd \"$APP_DIR\" && npx tsx src/index.ts"]
