# syntax=docker/dockerfile:1.6
# Build the Eve Dashboard as a self-contained Next.js standalone image.
#
# Stages:
#   deps    — install workspace dependencies (cached on lockfile changes)
#   build   — compile @eve/dna and the dashboard
#   runner  — minimal runtime image with the standalone bundle only

ARG NODE_VERSION=20-alpine

# --- deps -------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /workspace

# Lockfile + workspace metadata. Copying every package.json keeps the
# workspace graph consistent so `pnpm install --frozen-lockfile` succeeds.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/@eve/arms/package.json ./packages/@eve/arms/
COPY packages/@eve/brain/package.json ./packages/@eve/brain/
COPY packages/@eve/builder/package.json ./packages/@eve/builder/
COPY packages/@eve/dna/package.json ./packages/@eve/dna/
COPY packages/@eve/eyes/package.json ./packages/@eve/eyes/
COPY packages/@eve/legs/package.json ./packages/@eve/legs/
COPY packages/@eve/lifecycle/package.json ./packages/@eve/lifecycle/
COPY packages/cli-kit/package.json ./packages/cli-kit/
COPY packages/eve-cli/package.json ./packages/eve-cli/
COPY packages/eve-dashboard/package.json ./packages/eve-dashboard/
COPY packages/install/package.json ./packages/install/
COPY packages/types/package.json ./packages/types/
COPY packages/usb/package.json ./packages/usb/
COPY packages/utils/package.json ./packages/utils/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/packages ./packages
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Source for the packages we need to ship. Dashboard imports:
#   - @eve/dna       : registry, secrets contract, entity state
#   - @eve/legs      : TraefikService, dashboard container helpers
#   - @eve/lifecycle : install/remove/update/start/stop primitives
#   - @eve/brain, @eve/eyes : dynamically imported by lifecycle install recipes
COPY packages/@eve/dna ./packages/@eve/dna
COPY packages/@eve/legs ./packages/@eve/legs
COPY packages/@eve/lifecycle ./packages/@eve/lifecycle
COPY packages/@eve/brain ./packages/@eve/brain
COPY packages/@eve/eyes ./packages/@eve/eyes
COPY packages/eve-dashboard ./packages/eve-dashboard

ENV NEXT_TELEMETRY_DISABLED=1

# Build workspace deps in topological order, by hand. The pnpm `...<pkg>`
# filter syntax sometimes fails to expand inside Docker shells (depending
# on quoting + pnpm version), and silently building only the leaf produces
# very confusing "Module not found: '@eve/dna'" errors at link time.
# Order matters:
#   dna       — no workspace deps
#   legs      — depends on dna
#   brain     — depends on dna, legs
#   eyes      — depends on dna, brain
#   lifecycle — depends on dna, legs, brain, eyes
#   dashboard — depends on dna, legs, lifecycle
RUN pnpm --filter @eve/dna run build
RUN pnpm --filter @eve/legs run build
RUN pnpm --filter @eve/brain run build
RUN pnpm --filter @eve/eyes run build
RUN pnpm --filter @eve/lifecycle run build
RUN pnpm --filter @eve/dashboard run build

# --- runner -----------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
# - tini       — proper PID 1 / signal forwarding
# - docker-cli — wire-ai.ts shells out to `docker exec` to configure
#                OpenClaw's auth-profiles.json. The dashboard reaches the
#                host daemon via the mounted /var/run/docker.sock.
RUN apk add --no-cache tini docker-cli

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone output ships its own minimal node_modules + server.js.
# In a monorepo it preserves the packages/eve-dashboard subpath.
COPY --from=build /workspace/packages/eve-dashboard/.next/standalone ./
COPY --from=build /workspace/packages/eve-dashboard/.next/static ./packages/eve-dashboard/.next/static

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/eve-dashboard/server.js"]
