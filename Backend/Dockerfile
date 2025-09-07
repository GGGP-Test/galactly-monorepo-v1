# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# install (works with or without a lockfile)
COPY package*.json ./
RUN npm install

# build TS
COPY . .
RUN npm run build

# keep only prod deps
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
