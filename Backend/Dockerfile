# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps to build TS (works with or without a lockfile)
COPY package*.json ./
RUN npm install

# Copy source and compile TS -> CJS in dist/
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Bring only what we need
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Create a minimal runtime package.json that guarantees CommonJS
# (This overrides whatever "type" you have in the repo.)
RUN printf '{\n  "name": "packlead-runtime",\n  "private": true,\n  "type": "commonjs",\n  "main": "dist/index.js"\n}\n' > package.json

# Optional sanity check during build (leave or remove)
# RUN node -e "console.log('runtime package.type =', require('./package.json').type)"

CMD ["node", "dist/index.js"]
