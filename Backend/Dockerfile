# ---- builder ----
FROM node:20-alpine AS builder
# toolchain for any optional native deps that may need to build
RUN apk add --no-cache g++ make python3
WORKDIR /app

# Install ALL deps (incl dev) so tsx is present; skip optional native extras
COPY package*.json ./
RUN npm ci --omit=optional

# Bring the source so tsx can execute TS directly (no TS build needed)
COPY tsconfig.json ./tsconfig.json
COPY src ./src

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Minimal files required at runtime (includes node_modules with tsx)
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules ./node_modules

# healthcheck: GET /healthz on the internal port
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz') \
  .then(r=>{if(r.ok)process.exit(0);process.exit(1)}) \
  .catch(()=>process.exit(1))"

EXPOSE 8787

# Start the server via Node's loader for tsx (no brittle internal path)
CMD ["node","--enable-source-maps","--loader","tsx","src/index.ts"]