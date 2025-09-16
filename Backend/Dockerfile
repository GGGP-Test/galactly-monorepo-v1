# syntax=docker/dockerfile:1.5

FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Native deps for any node-gyp packages (removed after install)
RUN apk add --no-cache --virtual .build-deps python3 make g++

# Copy the whole repo (robust to subfolders / case differences)
COPY . .

# Detect the application directory that contains package.json
# Prefer common names; otherwise pick the first package.json up to depth 3.
RUN set -eux; \
  CAND=""; \
  for d in Backend backend app server api packages/backend; do \
    if [ -f "$d/package.json" ]; then CAND="$d"; break; fi; \
  done; \
  if [ -z "$CAND" ]; then \
    CAND="$(dirname "$(find . -maxdepth 3 -type f -name package.json | head -n1 || echo .)")"; \
  fi; \
  echo "${CAND:-.}" > /app/.appdir; \
  echo "APP_DIR=$(cat /app/.appdir)"

# Install deps inside the detected app dir
RUN set -eux; cd "$(cat /app/.appdir)" \
  && npm ci --no-audit --no-fund

# Remove build deps for smaller runtime
RUN apk del .build-deps || true

# Lightweight start wrapper (avoids printf/% issues)
RUN <<'EOF' sh
set -eux
cat > /usr/local/bin/start <<'SH'
#!/bin/sh
set -eu
APP_DIR="$(cat /app/.appdir 2>/dev/null || echo .)"
cd "/app/${APP_DIR}"
export PORT="${PORT:-8787}"
# tsx is in devDependencies; npx will resolve it locally
exec npx tsx src/index.ts
SH
chmod +x /usr/local/bin/start
EOF

EXPOSE 8787
CMD ["start"]
