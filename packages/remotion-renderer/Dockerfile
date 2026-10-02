# syntax=docker/dockerfile:1.6
# Self-hosted Remotion renderer — the service the Synap `remotion` capability calls.
#
# Build context: the remotion-renderer package directory.
#   docker build -f packages/remotion-renderer/Dockerfile -t remotion-renderer:local packages/remotion-renderer
#
# The renderer's own PROJECT is NOT baked in: it is bind-mounted at runtime from
# REMOTION_PROJECT_PATH, so the operator can point the renderer at their own
# compositions without rebuilding this image.

ARG NODE_VERSION=20-bookworm-slim

FROM node:${NODE_VERSION}

# Chromium + the shared libs Remotion's headless renderer drives. Without these
# a render fails with "chrome not found" at render time, not build time.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      libnss3 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libasound2 \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Remotion's headless browser lookup honours this so it does not try to download
# its own Chrome on first render.
ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV REMOTION_PROJECT_PATH=/opt/remotion

COPY package.json ./
# The lockfile is deliberately not required: this package is installed with npm,
# not pnpm, so it resolves independently of the monorepo lockfile.
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
# The Remotion project template that gets seeded by the Eve installer (seedRemotionProject).
# This is the source of truth for the initial seeding operation, and contains the
# default starter composition (src/index.ts) and scaffolding.
COPY project-template ./project-template

# A writable place for the project + rendered output when the operator does not
# bind-mount their own. The installer bind-mounts over it by default.
RUN mkdir -p /opt/remotion /opt/remotion/out

EXPOSE 8080

CMD ["node", "src/index.js"]
