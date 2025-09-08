# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps to build TS (lockfile optional)
COPY package*.json ./
RUN npm install

# Bring the source and compile TS -> dist/
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Only what's needed to run
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Force CJS at runtime: never copy the repo package.json
RUN rm -f package.json \
 && printf '{\n  "name": "packlead-runtime",\n  "private": true,\n  "type": "commonjs",\n  "main": "dist/index.cjs"\n}\n' > package.json \
 && echo "runtime package.json written (type=commonjs)"

# Belt-and-braces: make all compiled files .cjs
RUN find dist -type f -name "*.js" -exec sh -c 'for f; do mv "$f" "${f%.js}.cjs"; done' sh {} + \
 && echo "renamed dist/*.js -> *.cjs"

CMD ["node", "dist/index.cjs"]
