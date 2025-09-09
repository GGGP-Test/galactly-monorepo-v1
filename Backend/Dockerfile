# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# install deps from your repo's package.json
COPY package*.json ./
RUN npm ci || npm install

# compile ONLY the entrypoint (we'll add the tsconfig below)
COPY tsconfig.runtime.json ./tsconfig.runtime.json
COPY src ./src
RUN npm run build:runtime

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy compiled code + dependencies (so express is available)
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

# force CommonJS at runtime to avoid the ESM "exports is not defined" crash
RUN printf '{\n  "name": "packlead-runtime",\n  "private": true,\n  "type": "commonjs",\n  "main": "dist/index.js"\n}\n' > package.json

CMD ["node", "dist/index.js"]
