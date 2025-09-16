# Root Dockerfile that builds the Backend/ service for Northflank
FROM node:20-alpine

# Quiet npm a bit
ENV npm_config_loglevel=warn

# Native build tools for any node-gyp deps (gets removed after install)
RUN apk add --no-cache --virtual .build-deps python3 make g++

# Work under /app/Backend so paths match your code
WORKDIR /app/Backend

# 1) Install dependencies from Backend/package.json
# Try npm ci first (if lock exists), otherwise fallback to npm install.
COPY Backend/package*.json ./
RUN (npm ci --no-audit --no-fund --include=dev || npm install --no-audit --no-fund --include=dev)

# 2) Copy Backend source only (keeps build context small)
COPY Backend/. .

# We don't need build tools at runtime
RUN apk del .build-deps

# 3) Start the API with tsx (dev dep installed above)
EXPOSE 8080
CMD ["npx","tsx","src/index.ts"]
