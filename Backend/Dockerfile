# Build the Backend/ service on Northflank (robust COPY)
FROM node:20-alpine

ENV npm_config_loglevel=warn

# native build tools (removed later)
RUN apk add --no-cache --virtual .build-deps python3 make g++

# Work at /app
WORKDIR /app

# 1) Bring in Backend package files and install deps inside /app/Backend
COPY Backend/package*.json ./Backend/
RUN cd Backend && (npm ci --no-audit --no-fund --include=dev || npm install --no-audit --no-fund --include=dev)

# 2) Copy the rest of Backend explicitly to /app/Backend
COPY Backend ./Backend

# 3) Drop build deps; run from Backend with tsx
RUN apk del .build-deps
WORKDIR /app/Backend
EXPOSE 8080
CMD ["npx","tsx","src/index.ts"]
