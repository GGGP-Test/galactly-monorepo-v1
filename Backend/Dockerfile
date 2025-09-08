# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# deps (works with or without a lockfile)
COPY package*.json ./
RUN npm ci || npm install

# compile TS -> dist/
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy runtime bits
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# force CommonJS at runtime (ignore repo package.json completely)
RUN printf '{\n  "name": "packlead-runtime",\n  "private": true,\n  "type": "commonjs",\n  "main": "dist/index.js"\n}\n' > package.json \
 && echo "runtime package.json written (type=commonjs)"

# start
CMD ["node", "dist/index.js"]
