# ---------- build ----------
FROM node:20-alpine AS build
ARG APP_DIR=.
WORKDIR /app

# Install deps (no lockfile required) to build TS
COPY ${APP_DIR}/package*.json ./
RUN npm install

# Copy the rest of the source
COPY ${APP_DIR}/ ./

# Compile TS -> CJS in dist/
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Keep the app package.json that declares "type":"commonjs"
COPY --from=build /app/package.json ./package.json

# Use the deps from build and prune dev
COPY --from=build /app/node_modules ./node_modules
RUN npm prune --omit=dev

# Copy compiled JS only
COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
