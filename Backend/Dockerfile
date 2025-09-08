# -------- build stage --------
FROM node:20-alpine AS build
WORKDIR /app

# copy ONLY the app's package files (no monorepo root lockfile required)
COPY package.json ./
# if you have package-lock.json, COPY it too; otherwise npm install is fine
# COPY package-lock.json ./

# install deps to build TypeScript
RUN npm install

# bring in the rest of your source
COPY . .

# compile TS -> CJS in dist/
RUN npm run build

# -------- runtime stage --------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy the app's package.json that sets "type":"commonjs"
COPY --from=build /app/package.json ./package.json

# copy runtime deps + compiled JS only
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist

# sanity: show what Node thinks the module type is at runtime
# (uncomment once to verify if you still hit ESM/CJS mismatch)
# RUN node -e "console.log('package type:', require('./package.json').type)"

CMD ["node", "dist/index.js"]
