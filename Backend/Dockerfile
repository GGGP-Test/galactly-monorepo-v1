# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# deps (works with or without a lockfile)
COPY package*.json ./
RUN npm ci || npm install

# bring in just what we need to compile the entrypoint
COPY tsconfig.runtime.json ./tsconfig.runtime.json
COPY src ./src

# compile only src/index.ts -> dist/index.js
RUN npm run build:runtime

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy compiled app
COPY --from=build /app/dist ./dist

# force CJS at runtime regardless of repo settings
RUN printf '{\n  "name": "packlead-runtime",\n  "private": true,\n  "type": "commonjs",\n  "main": "dist/index.js"\n}\n' > package.json

CMD ["node", "dist/index.js"]
