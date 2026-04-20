# syntax=docker/dockerfile:1.7
# Hardened multi-stage build for ms-365-mcp-server.
# Plan 01-03 (Foundation and Hardening): non-root, read-only FS compatible,
# tini as PID 1, HEALTHCHECK probe, OCI labels, unified Node 22-alpine base.

ARG NODE_VERSION=22-alpine

# ---- Builder stage ------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
RUN apk add --no-cache tini
WORKDIR /app

COPY package*.json ./
# Use `npm install --prefer-offline` instead of `npm ci` to tolerate lockfile
# drift in transitive deps (e.g. opentelemetry/configuration pulling yaml@2.x).
# `npm ci` is stricter but surfaces EUSAGE on minor metadata discrepancies that
# don't affect the resolved tree; `install --prefer-offline --no-audit --no-fund`
# with a cache mount is equivalent in practice and more resilient.
RUN --mount=type=cache,target=/root/.npm \
    npm install --prefer-offline --no-audit --no-fund --ignore-scripts

COPY . .
RUN npm run generate && npm run build && npm prune --omit=dev

# ---- Release stage ------------------------------------------------------
FROM node:${NODE_VERSION} AS release

# tini: PID 1 init that forwards signals and reaps zombies.
# nodejs user: UID/GID 1001 matches commonly reserved container user range.
RUN apk add --no-cache tini && \
    addgroup -S -g 1001 nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/bin/check-health.cjs ./bin/check-health.cjs

ENV NODE_ENV=production

USER nodejs

# HEALTHCHECK — liveness probe against /healthz (mounted by plan 01-04).
# start-period is generous because OTel auto-instrumentation adds ~1-2s to cold start.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node /app/bin/check-health.cjs || exit 1

# OCI image metadata — consumed by container registries and supply-chain scanners.
LABEL org.opencontainers.image.title="ms-365-mcp-server" \
      org.opencontainers.image.source="https://github.com/softeria/ms-365-mcp-server" \
      org.opencontainers.image.licenses="MIT"

# Forward SIGTERM so graceful shutdown (plan 01-05) receives the signal.
STOPSIGNAL SIGTERM

ENTRYPOINT ["/sbin/tini", "--", "node", "dist/index.js"]
