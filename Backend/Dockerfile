# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN printf '{\n  "name": "packlead-runtime",\n  "private": true,\n  "type": "commonjs",\n  "main": "dist/index.js"\n}\n' > package.json
CMD ["node", "dist/index.js"]
