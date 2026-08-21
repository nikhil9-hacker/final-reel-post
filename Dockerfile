# ==========================================
# STAGE 1: Build static assets and backend
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy codebase
COPY . .

# Compile application (both React SPA & Express backend via esbuild)
RUN npm run build

# ==========================================
# STAGE 2: Production runtime image
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy compiled bundles and assets from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/index.html ./index.html

# Expose port 3000
EXPOSE 3000

# Start server
CMD ["node", "dist/server.cjs"]
