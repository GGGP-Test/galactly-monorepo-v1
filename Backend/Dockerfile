FROM node:20-alpine

# System
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

# Deps
COPY package.json package-lock.json* ./
RUN npm ci

# App
COPY tsconfig.json ./
COPY src ./src

EXPOSE 8787
CMD ["npm","start"]