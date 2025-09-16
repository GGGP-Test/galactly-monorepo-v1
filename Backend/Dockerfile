FROM node:20-alpine
WORKDIR /app
ENV npm_config_loglevel=warn
COPY Backend/package*.json ./
RUN npm install --no-audit --no-fund --include=dev
COPY Backend/. .
EXPOSE 8080
CMD ["npx","tsx","src/index.ts"]
