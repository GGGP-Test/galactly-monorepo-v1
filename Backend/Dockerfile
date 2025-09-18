# ---- single-stage runtime image (no separate build step) ----
FROM node:20-alpine

# Work in /app
WORKDIR /app

# Install ALL deps so tsx is available at runtime; skip optional natives to avoid build noise
COPY package*.json ./
RUN npm ci --omit=optional

# Bring tsconfig + source (tsx runs TS directly)
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

# Start via npm so Northflank's default override (docker-entrypoint.sh npm start) also works
CMD ["npm","start"]