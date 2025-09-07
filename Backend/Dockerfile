# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy pkg + lock and install prod deps
COPY package*.json ./
RUN npm ci --omit=dev

# copy compiled app
COPY --from=build /app/dist ./dist

# 🔒 force runtime to CJS no matter what
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.type='commonjs';fs.writeFileSync('package.json',JSON.stringify(p,null,2));"

# helpful: confirm at startup what Node sees
CMD ["node","-e","console.log('pkg type=',require('./package.json').type); require('./dist/index.js')"]
