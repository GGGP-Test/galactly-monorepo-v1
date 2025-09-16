# Root Dockerfile – builds and runs the Backend service on Northflank.

FROM node:20-alpine

ENV NODE_ENV=production
ENV npm_config_loglevel=warn

# Native build tools (only during install; removed later)
RUN apk add --no-cache --virtual .build-deps python3 make g++ wget

# Work under the Backend app (capital B matters)
WORKDIR /app/Backend

# 1) Install deps (cache-friendly layer)
COPY Backend/package*.json ./
RUN npm ci --no-audit --no-fund

# 2) Copy source
COPY Backend/. .

# 3) Drop build deps (runtime is pure Node)
RUN apk del .build-deps || true

# Default port for Northflank p01
EXPOSE 8787

# Healthcheck (Northflank shows green when this returns 200)
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8787}/healthz" || exit 1

# Start TS directly with tsx (dev dep installed by npm ci)
CMD ["npx","tsx","src/index.ts"]
