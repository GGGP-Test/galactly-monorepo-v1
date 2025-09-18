# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# install all deps (incl dev) to compile
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

# only prod deps for runtime
COPY package*.json ./
RUN npm ci --omit=dev

# bring compiled JS
COPY --from=builder /app/dist ./dist

# healthcheck hits /healthz on the internal port
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8787) +'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

# start
CMD ["node","dist/index.js"]