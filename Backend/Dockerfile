# Root Dockerfile — robust Backend build/run for Northflank

FROM node:20-alpine

# Quiet npm a bit
ENV npm_config_loglevel=warn \
    NODE_ENV=production

# Native build tools for any node-gyp deps (removed later)
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && apk add --no-cache bash curl

# Work under /app and copy the whole repo (keeps path quirks simple)
WORKDIR /app
COPY . .

# Detect the actual app dir that contains package.json (prefer Backend/)
# Writes result to /app/.appdir for later steps.
RUN set -eux; \
    CAND=""; \
    for d in Backend backend api server app .; do \
      if [ -d "$d" ] && [ -f "$d/package.json" ]; then CAND="$d"; break; fi; \
    done; \
    if [ -z "$CAND" ]; then \
      CAND="$(dirname "$(find . -maxdepth 3 -type f -name package.json | head -n1)")"; \
    fi; \
    echo "$CAND" > /app/.appdir; \
    echo "APP_DIR=${CAND}"

# Install deps inside the detected app dir.
# Use npm ci when a lockfile exists; otherwise fall back to npm install.
RUN set -eux; \
    APP_DIR="$(cat /app/.appdir)"; \
    cd "$APP_DIR"; \
    if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
      echo "Using npm ci"; \
      npm ci --no-audit --no-fund; \
    else \
      echo "No lockfile detected — using npm install"; \
      npm install --no-audit --no-fund --legacy-peer-deps; \
    fi; \
    npm cache clean --force

# We don't need build tools at runtime
RUN apk del .build-deps

# Lightweight start wrapper that cds into detected app dir and runs the API
RUN printf '#!/bin/sh\nset -eu\nAPP_DIR=$(cat /app/.appdir)\ncd "$APP_DIR"\nexec npx tsx src/index.ts\n' > /usr/local/bin/start \
 && chmod +x /usr/local/bin/start

# If you expose a port, do it here (not required by Northflank)
# EXPOSE 8787

CMD ["start"]
