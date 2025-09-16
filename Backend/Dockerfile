# Universal Dockerfile — auto-detects app subfolder (Backend/backend/…)
FROM node:20-alpine

ENV npm_config_loglevel=warn

# Native build tools for any node-gyp deps (removed later)
RUN apk add --no-cache --virtual .build-deps python3 make g++

# Work at /app and copy the whole repo (robust to path/case quirks)
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
    CAND="$(dirname "$(find . -maxdepth 3 -type f -name package.json | head -n1 || echo .)")"; \
  fi; \
  echo "APP_DIR=${CAND#.}/" > /app/.appdir; \
  printf ">> Using APP_DIR=%s\n" "$CAND"; \
  cd "$CAND"; \
  (npm ci --no-audit --no-fund --include=dev || npm install --no-audit --no-fund --include=dev)

# Drop build deps for a smaller runtime
RUN apk del .build-deps

# Lightweight start wrapper that cds into detected app dir and runs the API
RUN printf '#!/bin/sh\nset -eu\nAPP_DIR=$(cut -d= -f2 /app/.appdir)\ncd "/app/${APP_DIR%/}"\nexec npx tsx src/index.ts\n' > /usr/local/bin/start && chmod +x /usr/local/bin/start

EXPOSE 8080
CMD ["start"]
