# ---- builder: install dev deps and compile TS -> JS ----
FROM node:20-alpine AS builder
WORKDIR /app

# Useful build tools (harmless if not needed by your deps)
RUN apk add --no-cache g++ make python3

# Copy manifest first for better layer caching
COPY package*.json ./

# Install ALL deps needed to compile (dev included), skip optional native extras
# NOTE: correct npm syntax is --omit=optional (not --omit-optional)
RUN npm ci --omit=optional

# Bring in the TypeScript project and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runner: slim image with prod deps only ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787

# Only production + non-optional dependencies
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# Bring compiled JS only
COPY --from=builder /app/dist ./dist

# Health check against your internal /healthz
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 8787

# Run the compiled server directly (no npm scripts needed)
CMD ["node","dist/index.js"]