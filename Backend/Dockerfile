# ---- runtime only (no build step) ----
FROM node:20-alpine

WORKDIR /app

# Install prod deps; tsx must be in regular dependencies (not just dev)
COPY package*.json ./
RUN npm ci --omit=dev

# Bring tsconfig + sources
COPY tsconfig.json ./
COPY src ./src

# Service config
ENV NODE_ENV=production
ENV PORT=8787

# Healthcheck hits the in-container port
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

# Start with tsx (compiled on-the-fly)
CMD ["npm","start"]
