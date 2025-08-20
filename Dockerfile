# ---------- build ----------
FROM node:20-bookworm AS build
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# install deps inside Backend
COPY Backend/package*.json Backend/tsconfig.json* ./Backend/
WORKDIR /app/Backend
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
RUN npm i -D typescript ts-node --no-save

# copy sources and compile
COPY Backend/ /app/Backend/
RUN npx tsc -p .
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-bookworm AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8787

# backend
COPY --from=build /app/Backend/dist /app/Backend/dist
COPY --from=build /app/Backend/node_modules /app/Backend/node_modules

# static site files from repo root
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
