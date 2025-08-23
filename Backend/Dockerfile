# Build & run the Backend service (TypeScript → JS)
FROM node:20-alpine
WORKDIR /app


# 1) Install deps using only package files for cache
COPY Backend/package*.json ./
RUN npm ci


# 2) Copy source and build
COPY Backend/ ./
RUN npm run build && cp -f src/schema.sql dist/schema.sql || true


EXPOSE 8787
CMD ["node","dist/Index.js"]
