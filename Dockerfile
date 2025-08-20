# ---------- build stage ----------
FROM node:20-bookworm AS build
WORKDIR /app

# native deps for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# install deps in Backend/
COPY Backend/package*.json Backend/tsconfig.json* ./Backend/
WORKDIR /app/Backend
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
RUN npm i -D typescript ts-node --no-save

# copy the rest of Backend sources
COPY Backend/ /app/Backend/
# compile TS → Backend/dist
RUN npx tsc -p .

# keep only production deps
RUN npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:20-bookworm AS runtime
WORKDIR /app

# native deps for better-sqlite3 at runtime
RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8787

# backend runtime
COPY --from=build /app/Backend/dist /app/Backend/dist
COPY --from=build /app/Backend/node_modules /app/Backend/node_modules

# static front-end (from repo root)
COPY api-base.js ./api-base.js
COPY engines.html ./engines.html
COPY free-panel.html ./free-panel.html
COPY index.html ./index.html
COPY onboarding ./onboarding
COPY store.html ./store.html
COPY style.css ./style.css
COPY sw.js ./sw.js

EXPOSE 8787
CMD ["node","Backend/dist/index.js"]
