FROM node:20-alpine
WORKDIR /app


# deps
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi


# source
COPY . .


# build TS -> dist (don’t rely on package.json script)
RUN npx tsc -p tsconfig.json && cp -f src/schema.sql dist/schema.sql || true


EXPOSE 8787
CMD ["node","dist/index.js"]
