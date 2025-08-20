# ---- build stage ----
FROM node:20-bookworm AS build
WORKDIR /app

# system deps for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# If you only have package.json, this still works
RUN npm ci

COPY tsconfig.json . 2>/dev/null || true
COPY Backend ./Backend
COPY api-base.js engines.html free-panel.html index.html onboarding store.html style.css sw.js ./ 2>/dev/null || true

# If you have a build script, use it; else transpile TS on-the-fly later.
# Recommended: add "build": "tsc -p ." to package.json and uncomment next line:
# RUN npm run build

# ---- runtime stage ----
FROM node:20-bookworm AS runtime
WORKDIR /app

# system deps for better-sqlite3 at runtime
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Render sets PORT for us; your code already uses process.env.PORT || 8787
ENV PORT=8787

COPY --from=build /app /app

# If you compiled to dist: change CMD to ["node","dist/index.js"]
# If you run TS directly, use ts-node/register. We’ll use node to run compiled JS if available,
# else fall back to ts-node.
CMD [ "bash", "-lc", "\
  if [ -f dist/index.js ]; then node dist/index.js; \
  else node --loader ts-node/esm Backend/index.ts || node -r ts-node/register Backend/index.ts; fi" ]
