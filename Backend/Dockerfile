# ---- build ----
FROM node:20-bookworm AS build
WORKDIR /app

# native deps for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# install deps (Backend is the build context)
COPY package*.json tsconfig.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
RUN npm i -D typescript ts-node --no-save

# copy sources and compile
COPY . .
# generate giant feed lists into /app/generated
RUN mkdir -p generated && node --loader ts-node/esm scripts/feeds.expand.ts --out-native generated/feeds_native.txt --out-rsshub generated/rsshub_feeds.txt --rsshub-base "$RSSHUB_BASE" --rsshub-key "$RSSHUB_KEY"

RUN npx tsc -p .
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:20-bookworm AS runtime
WORKDIR /app

# native deps for better-sqlite3 at runtime
RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8787

COPY --from=build /app/dist /app/dist
COPY --from=build /app/node_modules /app/node_modules

EXPOSE 8787
CMD ["node","dist/index.js"]
