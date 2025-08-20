# ---------- build stage ----------
FROM node:20-bookworm AS build
WORKDIR /app

# native build deps for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# install deps
COPY package*.json ./
RUN npm ci

# ensure TS toolchain is available even if not in your package.json
RUN npm i -D typescript ts-node --no-save

# bring in the whole repo (simple & robust)
COPY . .

# provide a minimal tsconfig if missing (safe no-op if you already have one)
RUN test -f tsconfig.json || printf '%s\n' \
'{ "compilerOptions": { "target":"ES2020","module":"ES2022","moduleResolution":"node", "outDir":"dist", "esModuleInterop":true, "skipLibCheck":true }, "include":["Backend/**/*.ts","*.ts"] }' \
> tsconfig.json

# compile TS → dist
RUN npx tsc -p .

# keep only production deps for runtime
RUN npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:20-bookworm AS runtime
WORKDIR /app

# native runtime deps for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8787

# copy compiled app + prod node_modules + public files
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

# front-end files (adjust to your repo; all are present at repo root)
COPY --from=build /app/api-base.js ./api-base.js
COPY --from=build /app/engines.html ./engines.html
COPY --from=build /app/free-panel.html ./free-panel.html
COPY --from=build /app/index.html ./index.html
COPY --from=build /app/onboarding ./onboarding
COPY --from=build /app/store.html ./store.html
COPY --from=build /app/style.css ./style.css
COPY --from=build /app/sw.js ./sw.js

# start the compiled API (Backend/index.ts → dist/Backend/index.js)
EXPOSE 8787
CMD ["bash","-lc","if [ -f dist/Backend/index.js ]; then node dist/Backend/index.js; elif [ -f dist/index.js ]; then node dist/index.js; else echo 'No dist entry found'; ls -R dist; exit 1; fi"]
