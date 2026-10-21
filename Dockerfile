# Multi-stage production Dockerfile for ACM Content Marketing Studio
# Compatible with Node 22, Puppeteer headless Chromium, and persistent photo volume

# ------------------------------------------------------------------------------
# Stage 1: Build Frontend Assets
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS client-builder
WORKDIR /app

# Copy package manifests and workspace configurations
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY core/package.json ./core/
COPY server/package.json ./server/

# Install build dependencies
RUN npm ci

# Copy client and core sources
COPY client/ ./client/
COPY core/ ./core/

# Build client production bundle
RUN npm run build --workspace=@acm-studio/client

# ------------------------------------------------------------------------------
# Stage 2: Production Server Runtime with Chromium Dependencies
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

# Install essential system libraries required by Puppeteer Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production environment settings
ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer \
    PHOTOS_DIR=/data/photos

# Copy root manifests
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY core/package.json ./core/
COPY server/package.json ./server/

# Install production dependencies and download Chromium browser
RUN npm ci --omit=dev

# Copy application code and assets
COPY core/ ./core/
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY assets/ ./assets/
COPY content/ ./content/

# Copy built frontend from client-builder
COPY --from=client-builder /app/client/dist ./client/dist

# Set up persistent photo storage directory and permissions
RUN mkdir -p /data/photos /home/node/.cache/puppeteer \
    && chown -R node:node /app /data/photos /home/node/.cache \
    && chmod 777 /data/photos

USER node

EXPOSE 3000

# Container healthcheck querying the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "scripts/serve.js"]
