# ---- builder ----
FROM node:20-alpine AS builder

# native toolchain for any deps that need to build
RUN apk add --no-cache g++ make python3

WORKDIR /app

# install deps (incl dev) first for better caching
COPY package*.json ./
RUN npm ci --omit=optional

# bring the rest of the source
COPY tsconfig.json ./
COPY src ./src

# compile TS -> JS (expects "build": "tsc" in package.json)
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# install only prod deps for runtime
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# bring compiled JS and anything else needed at runtime
COPY --from=builder /app/dist ./dist

# healthcheck hits /healthz on the internal port (no curl in alpine, use node)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 8787

# run the built JS directly (avoid npm so we don't need package.json at boot)
CMD ["node", "dist/index.js"]