# Build/Type-check stage
FROM node:20-alpine AS build
WORKDIR /app

# Quieter, faster npm
ENV npm_config_loglevel=warn

# 1) Install deps (tolerates out-of-sync lock)
COPY package*.json ./
RUN npm install --no-audit --no-fund

# 2) Copy sources and configs
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.runtime.json ./tsconfig.runtime.json
COPY src ./src

# 3) Type-check (no emit)
RUN npx tsc -p tsconfig.runtime.json
