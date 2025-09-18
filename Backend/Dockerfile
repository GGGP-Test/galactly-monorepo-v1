# ---- runtime-only (no TS build step) ----
FROM node:20-alpine

# Work inside /app
WORKDIR /app

# Bring only the files needed to install deps (cache-friendly)
COPY package*.json ./

# Install ALL deps (including dev so tsx is present),
# but DO NOT run lifecycle scripts that might try to compile TS, etc.
RUN npm ci --ignore-scripts

# Bring the source + tsconfig
COPY tsconfig.json ./
COPY src ./src

# Env & port (Northflank will map this)
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# Healthcheck hits /healthz on the internal port
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT || 8787) + '/healthz') \
    .then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

# Start the server directly with tsx from node_modules
# (works because we kept dev deps)
CMD ["node","--enable-source-maps","./node_modules/tsx/dist/cli.js","src/index.ts"]