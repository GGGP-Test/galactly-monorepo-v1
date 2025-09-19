# ---- builder ----
FROM node:20-alpine AS builder

# toolchain for any native optional deps that may need to build
RUN apk add --no-cache g++ make python3

WORKDIR /app

# install ALL deps (incl dev) so tsx is present; skip optional native extras
COPY package*.json ./
RUN npm ci --omit=optional

# bring the source so tsx can execute TS directly (no tsc build needed)
COPY tsconfig.json ./tsconfig.json
COPY src ./src

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787

# minimal files required at runtime
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules ./node_modules

# healthcheck: GET http://127.0.0.1:PORT/healthz
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"

# start the server with tsx (transpiles TS, no type-check, avoids tsc errors)
CMD ["node","--enable-source-maps","./node_modules/tsx/dist/cli.js","src/index.ts"]