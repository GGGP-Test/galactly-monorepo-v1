# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# install ALL deps (incl dev) so tsc can compile
COPY package*.json ./
RUN npm ci

# ts config + source
COPY tsconfig.json ./
COPY src ./src

# compile TS -> dist
RUN npm run build

# strip dev deps so runtime only has production deps
RUN npm prune --omit=dev

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# bring compiled JS + pruned deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# healthcheck hits /healthz on the internal port
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8787) +'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

# start the server directly (no tsx in runtime)
CMD ["node","--enable-source-maps","dist/index.js"]