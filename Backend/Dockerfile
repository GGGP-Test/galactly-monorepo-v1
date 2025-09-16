# Build the Backend app from the Backend/ folder
FROM node:20-alpine

WORKDIR /app
# keep npm quiet in CI
ENV npm_config_loglevel=warn

# 1) Install deps (include dev so tsx is available)
COPY Backend/package*.json ./
RUN npm install --no-audit --no-fund --include=dev

# 2) Copy app source
COPY Backend/. .

# 3) Runtime
ENV NODE_ENV=production
EXPOSE 8080
# Run TypeScript directly with tsx (installed above)
CMD ["npx","tsx","src/index.ts"]
