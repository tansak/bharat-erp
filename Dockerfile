# ─────────────────────────────────────────────────────────────────
# Bharat ERP — Production Dockerfile
# Node 20 LTS · Alpine · Non-root user · Health-check built in
# ─────────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first (layer cache: only re-run npm ci if these change)
COPY package.json ./

# Install production deps only
RUN npm install --omit=dev --ignore-scripts

# ── Stage 2: Production image ─────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root
RUN addgroup -S erp && adduser -S erp -G erp

WORKDIR /app

# Copy deps from Stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy source (respects .dockerignore if present)
COPY --chown=erp:erp . .

# Remove dev/test files from image
RUN rm -rf tests/ dashboard/ *.tar.gz

USER erp

# Railway injects PORT at runtime; default to 3000
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# Health-check: Railway will mark the deploy healthy when this passes
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "api/server.js"]
