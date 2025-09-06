# -------- build stage --------
FROM node:20-alpine AS build
WORKDIR /app

# optional: native modules support
RUN apk add --no-cache python3 make g++ pkgconfig

# install deps (works with or without package-lock.json)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# copy source and build
COPY . .
RUN npm run build

# -------- runtime stage --------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY --from=build /app/dist ./dist

# default is a no-op; Jobs override the command
CMD ["node", "-e", "console.log('image ready')"]
