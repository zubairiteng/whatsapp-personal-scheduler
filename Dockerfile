# ==============================================================================
# Multi-stage production Dockerfile for WhatsApp Personal Scheduler
# Built with system Chromium dependencies for stable headless browser automation.
# ==============================================================================

FROM node:22-bookworm-slim

# Prevent Chromium download during npm install to keep container slim & fast
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

# Install Chromium and required OS runtime dependencies for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-freefont-ttf \
    fonts-ipafont-gothic \
    fonts-kacst \
    fonts-wqy-zenhei \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    dumb-init \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package.json ./

# Install only production dependencies (omitting dev dependencies)
RUN npm install --omit=dev --no-audit --no-fund

# Copy source code and frontend assets
COPY src/ ./src/

# Create persistent data directory and grant permissions to node user
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root node user for container security
USER node

# Expose HTTP dashboard port
EXPOSE 3000

# Persistent volume for SQLite database and WhatsApp session tokens
VOLUME ["/app/data"]

# Use dumb-init to properly forward SIGTERM / SIGINT for graceful shutdown
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["node", "src/server.js"]
