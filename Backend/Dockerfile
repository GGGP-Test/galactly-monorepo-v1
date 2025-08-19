# Dockerfile (placed inside /Backend)
FROM node:20-bullseye

# Python/pip for snscrape
RUN apt-get update && apt-get install -y python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir snscrape

# App setup points to /Backend
WORKDIR /app/Backend
COPY Backend/package*.json ./
RUN npm ci

# Copy only the backend code folder
COPY Backend/ ./
RUN npm run build || true

ENV SNSCRAPE_CMD=/usr/local/bin/snscrape
ENV PORT=8787

CMD ["node","dist/index.js"]
