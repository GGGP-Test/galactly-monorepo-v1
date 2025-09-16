# Build a tiny, reliable image for the Backend service on Northflank
FROM node:20-alpine

# Quieter npm
ENV npm_config_loglevel=warn

# Work inside backend directory in the image
WORKDIR /app/Backend

# 1) Install deps using only Backend manifests (fast, cached)
COPY Backend/package*.json ./
RUN npm ci --no-audit --no-fund --include=dev

# 2) Copy backend source (keeps build context small & predictable)
COPY Backend/ ./

# 3) Run the API with tsx (TypeScript at runtime)
EXPOSE 8787
CMD ["npx","tsx","src/index.ts"]
