FROM node:22-slim

# Install Python 3 + lightweight Python market-data dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf python3 /usr/bin/python

# Lightweight Python deps (always useful for HTTP market data)
RUN pip3 install --no-cache-dir --break-system-packages \
    pytdx akshare requests

# Heavy Qlib ML dependencies (opt-in via build arg, adds ~400MB)
ARG INSTALL_QLIB=false
RUN if [ "$INSTALL_QLIB" = "true" ]; then \
    pip3 install --no-cache-dir --break-system-packages \
    numpy pandas scipy qlib; \
    fi

WORKDIR /app

# Install Node.js dependencies (omit devDependencies)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source (respects .dockerignore)
COPY . .

# Create runtime directories
RUN mkdir -p /app/data /app/logs

ENV PORT=3456
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PYTHON_BIN=python3

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3456/api/health || exit 1

CMD ["node", "server.js"]
