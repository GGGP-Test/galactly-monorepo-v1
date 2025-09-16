# Root Dockerfile building the Backend/ service
FROM node:20-alpine

ENV npm_config_loglevel=warn
WORKDIR /app/Backend

# 1) Install deps from Backend/
COPY Backend/package*.json ./
RUN npm install --no-audit --no-fund --include=dev

# 2) Copy Backend source only
COPY Backend/. .

# 3) Run API
EXPOSE 8080
CMD ["npx","tsx","src/index.ts"]
