# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# deps (include dev) to compile
COPY package*.json ./
RUN npm ci

# ts config + source
COPY tsconfig.json ./
COPY src ./src

# compile TS -> dist
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# only prod deps
COPY package*.json ./
RUN npm ci --omit-dev

# bring compiled JS
COPY --from=builder /app/dist ./dist

# healthcheck hits /healthz on the internal port
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 8787
CMD ["node", "dist/index.js"]
