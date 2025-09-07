# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# install (works even if you don't have package-lock.json)
COPY package*.json ./
RUN npm install

# build TS
COPY . .
RUN npm run build

# keep only prod deps to shrink size
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy runtime assets from build stage
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# force CommonJS at runtime (prevents "exports is not defined" again)
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.type='commonjs';fs.writeFileSync('package.json',JSON.stringify(p,null,2));"

CMD ["node","dist/index.js"]
