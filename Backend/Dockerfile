# Node 20, single-stage
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_loglevel=warn

# 1) Install deps (explicitly copy from Backend/ so build context doesn't matter)
COPY Backend/package*.json ./
RUN npm install --no-audit --no-fund

# 2) Copy source
COPY Backend/. .

EXPOSE 8080
# Run TS directly with tsx (installed via devDeps)
CMD ["npx","tsx","src/index.ts"]
