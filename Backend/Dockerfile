# Universal Dockerfile — auto-detects the app subfolder (Backend/backend/…)
FROM node:20-alpine

ENV npm_config_loglevel=warn

# Native build tools for any node-gyp deps (removed after install)
RUN apk add --no-cache --virtual .build-deps python3 make g++

# Work at /app and copy the whole repo (robust to path/case quirks)
WORKDIR /app
COPY . .

# Detect the real app dir that contains package.json (prefer Backend/)
# Store it in /app/.appdir and install deps there.
RUN set -eux; \
  CAND=""; \
  for d in Backend backend api server app .; do \
    if [ -d "$d" ] && [ -f "$d/package.json" ]; then CAND="$d"; break; fi; \
  done; \
  if [ -z "$CAND" ]; then \
    CAND="$(dirname "$(find . -maxdepth 3 -type f -name package.json | head -n1 || echo .)")"; \
  fi; \
  echo "APP_DIR=${CAND#.}/" > /app/.appdir; \
  echo ">> Using APP_DIR=${CAND}"; \
  cd "$CAND"; \
  (npm ci --no-audit --no-fund --include=dev || npm install --no-audit --no-fund --include=dev)

# Drop build deps for smaller runtime
RUN apk del .build-deps

# Write a tiny start wrapper using a HEREDOC (avoids printf % issues)
RUN cat > /usr/local/bin/start <<'SH' \
 && chmod +x /usr/local/bin/start
#!/bin/sh
set -eu
APP_DIR=$(cut -d= -f2 /app/.appdir)
cd "/app/${APP_DIR%/}"
exec npx tsx src/index.ts
SH

EXPOSE 8080
CMD ["start"]
