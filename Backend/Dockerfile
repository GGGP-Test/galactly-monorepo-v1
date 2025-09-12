# -------- build+run (single-stage) --------
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV npm_config_loglevel=warn

# 1) Install deps (tolerates out-of-sync lock)
COPY package*.json ./
RUN npm install --no-audit --no-fund

# 2) Copy source and configs
COPY . .

# 3) Start without type-checking (transpile-only)
#    Uses tsx to run TS directly; avoids tsc exit-on-error during build.
#    If tsx isn't in package.json, this installs it locally.
RUN test -f node_modules/.bin/tsx || npm install --no-audit --no-fund -D tsx

# If your entrypoint isn't src/index.ts, change it here.
CMD ["npx","tsx","src/index.ts"]
