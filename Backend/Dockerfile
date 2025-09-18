# ---- runtime (no separate build stage) ----
FROM node:20-alpine

# work inside /app
WORKDIR /app

# install deps (keep dev so tsx is available; drop optional to avoid native/optional build pain)
COPY package*.json ./
RUN npm ci --omit=optional

# bring source + tsconfig (tsx reads tsconfig)
COPY tsconfig.json ./
COPY src ./src

# env + port (Northflank maps this)
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# healthcheck calls /healthz on the internal port
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz') \
    .then(r=>{if(r.ok)process.exit(0);process.exit(1)}) \
    .catch(()=>process.exit(1))"

# start the server directly with tsx (no npm, no compile step)
CMD ["node","--enable-source-maps","./node_modules/tsx/dist/cli.js","src/index.ts"]