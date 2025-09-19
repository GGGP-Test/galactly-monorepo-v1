# ---- builder ----
FROM node:20-slim AS builder
ENV CI=true
WORKDIR /app

# Install deps (incl dev) so tsc can compile
COPY package*.json ./
RUN npm ci --omit=optional

# Copy any tsconfig variants + sources, then compile TS -> JS
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ---- runner ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Only prod deps for runtime (clean, reproducible)
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# Bring compiled JS
COPY --from=builder /app/dist ./dist

# Healthcheck uses Node's built-in fetch (no curl)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 8787
CMD ["node","dist/index.js"]