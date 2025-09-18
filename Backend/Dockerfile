# ---------- deps: install node modules ----------
FROM node:20-alpine AS deps
WORKDIR /app

# copy manifests first to leverage layer cache
COPY package*.json ./

# prefer deterministic installs; fall back to install if lock mismatches
RUN npm ci || npm install

# ---------- runner: copy code + deps and run with tsx ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

# bring installed node_modules (includes tsx in prod deps)
COPY --from=deps /app/node_modules ./node_modules

# bring runtime sources
COPY tsconfig.json ./tsconfig.json
COPY src ./src

# healthcheck against /healthz inside the container
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 8787
CMD ["npm","start"]