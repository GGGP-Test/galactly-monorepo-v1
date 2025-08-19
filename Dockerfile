# Dockerfile (repo root)
FROM node:20-bullseye

# 1) Python/pip for snscrape
RUN apt-get update && apt-get install -y python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir snscrape

# 2) App setup
WORKDIR /app
COPY package*.json ./
RUN npm ci

# 3) Copy source and build TypeScript
COPY . .
RUN npm run build || true

# 4) Tell the app where snscrape lives
ENV SNSCRAPE_CMD=/usr/local/bin/snscrape
ENV PORT=8787

# 5) Start the API
CMD ["node","dist/index.js"]
