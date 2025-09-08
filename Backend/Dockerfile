# -------- build stage --------
FROM node:20-alpine AS build
WORKDIR /app

# copy only this service's package files
COPY package.json ./
# If you actually have a lockfile in THIS folder, uncomment the next line
# COPY package-lock.json ./

# Install deps — use npm install because there's no lockfile in this folder
RUN npm install

# bring in the rest of the source
COPY . .

# compile TypeScript -> dist/
RUN npm run build

# prune dev deps to keep the runtime small
RUN npm prune --omit=dev

# -------- runtime stage --------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy runtime assets
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# hard-set type to commonjs INSIDE the image (guards against parent monorepo "type":"module")
RUN node -e "const fs=require('fs');const p=require('./package.json');p.type='commonjs';fs.writeFileSync('package.json',JSON.stringify(p,null,2))"

# helpful source maps in prod logs
ENV NODE_OPTIONS=--enable-source-maps

CMD ["node","dist/index.js"]
