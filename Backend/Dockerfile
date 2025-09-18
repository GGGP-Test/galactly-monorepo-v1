# ---- single-stage runtime image (no separate build step) ----
FROM node:20-alpine

# Work inside /app
WORKDIR /app

# Install ALL deps so tsx is present at runtime (skip optional native extras)
COPY package*.json ./
RUN npm ci --omit=optional

# Bring tsconfig + source (tsx executes TS directly)
COPY tsconfig.json ./
COPY src ./src

# Runtime env + port
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# Healthcheck hits /healthz on the internal port
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz') \
    .then(r=>{if(r.ok)process.exit(0);process.exit(1)}) \
    .catch(()=>process.exit(1))"

# Match Northflank’s default CMD override (docker-entrypoint.sh npm start)
CMD ["npm","start"]