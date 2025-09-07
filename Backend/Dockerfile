# ---------- build ----------
FROM node:20-alpine AS build
ARG APP_DIR=.
WORKDIR /app

# copy only the app's manifests and tsconfig
COPY ${APP_DIR}/package*.json ./ 
COPY ${APP_DIR}/tsconfig.json ./

# install full deps (prod + dev) to build TS
RUN npm ci

# copy source
COPY ${APP_DIR}/ ./ 

# compile
RUN npm run build

# keep only prod deps for runtime
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# bring over app artifacts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# force CommonJS at runtime in case a different package.json leaked earlier
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8')); if(p.type!=='commonjs'){p.type='commonjs'; fs.writeFileSync('package.json', JSON.stringify(p,null,2)); console.log('Forced package.json type=commonjs'); }"

EXPOSE 8080
CMD ["node","dist/index.js"]
