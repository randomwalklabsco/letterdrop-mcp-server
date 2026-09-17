# Multi-stage build for Letterdrop MCP Server

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

# The base tag lags behind Alpine's own security patches (openssl), and every
# package left behind is reported against the image.
RUN apk upgrade --no-cache

WORKDIR /app

# Install production dependencies only.
#
# npm is build-time only here — CMD execs node directly and nothing calls npm
# at runtime — but its bundled dependencies (tar, glob, sigstore, minimatch,
# brace-expansion, cross-spawn) ship inside the base image and are scanned as
# part of it. They cannot be addressed from package.json, so npm is removed
# from the runtime layer once the install is done.
COPY package*.json ./
RUN npm ci --production && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Set environment variables
ENV NODE_ENV=production
ENV MCP_SERVER_PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["node", "dist/index.js"]
