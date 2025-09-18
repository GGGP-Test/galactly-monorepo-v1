# ---- runtime only (no TS build step) ----
FROM node:20-alpine

WORKDIR /app

# Install ONLY prod deps; tsx must be a prod dep so runtime can use it
COPY package*.json ./
RUN npm ci --omit=dev

# Bring tsconfig + sources
COPY tsconfig.json ./
COPY src ./src

# env & health
ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

# start the server directly with tsx
CMD ["npm","start"]
