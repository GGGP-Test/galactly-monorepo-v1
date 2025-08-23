# Build & run the Backend service (TypeScript → JS)
FROM node:20-alpine AS base
WORKDIR /app


# Install backend deps
COPY Backend/package*.json ./Backend/
WORKDIR /app/Backend
RUN npm ci


# Copy source and build
COPY Backend/ /app/Backend/
RUN npm run build


EXPOSE 8787
CMD ["node","dist/Index.js"]
