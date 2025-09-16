# Root Dockerfile to build the Backend/ service on Northflank
FROM node:20-alpine

# Keep logs terse and installs reproducible enough
ENV npm_config_loglevel=warn

WORKDIR /app

# 1) Install deps from Backend/package.json (not repo root)
COPY Backend/package*.json ./
# Include dev deps so we can run tsx directly in the container
RUN npm install --no-audit --no-fund --include=dev

# 2) Copy the Backend source only (avoid copying CI and docs noise)
COPY Backend/. .

# 3) Expose HTTP port and start with tsx
EXPOSE 8080
CMD ["npx","tsx","src/index.ts"]
