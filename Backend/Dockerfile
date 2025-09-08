# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# install deps (works with or without a lockfile)
COPY package*.json ./
RUN npm install

# bring in the source and compile TS -> dist/
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy only what's needed to run
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# force CommonJS at runtime (do NOT copy repo package.json)
RUN rm -f package.json \
 && printf '{\n  "name": "packlead-runtime",\n  "private": true,\n  "type": "commonjs",\n  "main": "dist/index.cjs"\n}\n' > package.json \
 && echo "runtime package.json written (type=commonjs)"

# also make compiled files .cjs so Node ignores any 'type: module'
RUN find dist -type f -name "*.js" -exec sh -c 'for f; do mv "$f" "${f%.js}.cjs"; done' sh {} + \
 && echo "renamed dist/*.js -> *.cjs"

CMD ["node", "dist/index.cjs"]
