# syntax=docker/dockerfile:1.6
# Build the Eve Dashboard as a self-contained Next.js standalone image.
#
# Build context: the hestia-cli workspace root (workspaceRoot in dashboard-container.ts)
#   docker build -f packages/eve-dashboard/Dockerfile -t eve-dashboard:local .
#
# Stages:
#   deps    — install workspace dependencies (cached on lockfile changes)
#   build   — compile @eve/* packages and the dashboard
#   runner  — minimal runtime image with the standalone bundle only

ARG NODE_VERSION=20-alpine

# --- deps -------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /workspace

# Workspace metadata — pnpm needs this to resolve workspace links
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy package.json files for all workspace packages (for pnpm install caching)
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

# @synap-core/types resolves from the public npm registry — no local copy needed.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /workspace

COPY --from=deps /workspace/node_modules ./node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy full source for packages we need to build
COPY packages/@eve/dna ./packages/@eve/dna
COPY packages/@eve/legs ./packages/@eve/legs
COPY packages/@eve/lifecycle ./packages/@eve/lifecycle
COPY packages/@eve/brain ./packages/@eve/brain
COPY packages/@eve/eyes ./packages/@eve/eyes
COPY packages/eve-dashboard ./packages/eve-dashboard

ENV NEXT_TELEMETRY_DISABLED=1

# Build workspace deps in topological order:
#   @eve/dna       — no workspace deps
#   @eve/legs      — depends on dna
#   @eve/brain     — depends on dna, legs
#   @eve/eyes      — depends on dna, brain
#   @eve/lifecycle — depends on dna, legs, brain, eyes
#   @eve/dashboard — depends on dna, legs, lifecycle
# @synap-core/types comes from npm — already in node_modules, no build step needed.
RUN pnpm --filter @eve/dna run build
RUN pnpm --filter @eve/legs run build
RUN pnpm --filter @eve/brain run build
RUN pnpm --filter @eve/eyes run build
RUN pnpm --filter @eve/lifecycle run build
RUN pnpm --filter @eve/dashboard run build

# --- runner -----------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache tini docker-cli docker-cli-compose

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build /workspace/packages/eve-dashboard/.next/standalone ./
COPY --from=build /workspace/packages/eve-dashboard/.next/static ./packages/eve-dashboard/.next/static

# Static assets read at runtime (not followed by Next.js standalone tracer)
COPY --from=build /workspace/packages/@eve/lifecycle/assets ./packages/@eve/lifecycle/assets
COPY --from=build /workspace/packages/@eve/dna/assets ./packages/@eve/dna/assets

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/eve-dashboard/server.js"]
