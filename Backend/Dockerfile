# ---- builder: install deps (incl dev) ---------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Toolchain just in case some deps want to compile (safe to keep)
RUN apk add --no-cache g++ make python3

# Install ALL deps (we need dev deps because we run with tsx)
COPY package*.json ./
# Use install (not `ci`) to avoid lockfile mismatch; skip lifecycle scripts
RUN npm install --omit=optional --no-audit --no-fund --ignore-scripts

# ---- runner: run TS directly with tsx (no tsc build) ------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Bring runtime pieces
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./
COPY tsconfig.json ./tsconfig.json
COPY src ./src

# Healthcheck hits internal /healthz
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Start the server via tsx, skipping type-checking
CMD ["node", "--enable-source-maps", "./node_modules/tsx/dist/cli.js", "--transpile-only", "src/index.ts"]