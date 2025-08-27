FROM node:20-alpine
WORKDIR /app


# Dependencies first
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi


# Source & build
COPY . .
RUN npm run build || npx tsc -p tsconfig.json


EXPOSE 8787
CMD ["node","dist/Index.js"]
