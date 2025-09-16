# Root Dockerfile: build & run the Backend/ service on Northflank, robustly
FROM node:20-alpine

ENV npm_config_loglevel=warn

# Native build tools for any node-gyp deps (removed later)
RUN apk add --no-cache --virtual .build-deps python3 make g++

# Work at /app
WORKDIR /app

# 0) Copy the entire repo to avoid path issues with subfolders on the builder
#    (Your .dockerignore will still keep noise out if present.)
COPY . .

# 1) Install deps inside Backend/
RUN cd Backend && (npm ci --no-audit --no-fund --include=dev || npm install --no-audit --no-fund --include=dev)

# 2) Drop build deps; run the API from Backend with tsx
RUN apk del .build-deps
WORKDIR /app/Backend
EXPOSE 8080
CMD ["npx","tsx","src/index.ts"]
