# syntax=docker/dockerfile:1.6
# Build the Eve Dashboard as a self-contained Next.js standalone image.
#
# Build from the monorepo root:
#   DOCKER_BUILDKIT=1 docker build -f hestia-cli/packages/eve-dashboard/Dockerfile .
#
# Stages:
#   deps    — install workspace dependencies (cached on lockfile changes)
#   build   — compile @synap-core/types, @eve/dna and the dashboard
#   runner  — minimal runtime image with the standalone bundle only

ARG NODE_VERSION=20-alpine

# --- deps -------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /workspace

# Root workspace metadata — needed so pnpm resolves workspace links
# (e.g. @synap-core/types → link:synap-backend/packages/types)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# --- hestia-cli workspace packages (package.json only for deps stage) ---
COPY hestia-cli/packages/@eve/arms/package.json ./hestia-cli/packages/@eve/arms/
COPY hestia-cli/packages/@eve/brain/package.json ./hestia-cli/packages/@eve/brain/
COPY hestia-cli/packages/@eve/builder/package.json ./hestia-cli/packages/@eve/builder/
COPY hestia-cli/packages/@eve/dna/package.json ./hestia-cli/packages/@eve/dna/
COPY hestia-cli/packages/@eve/eyes/package.json ./hestia-cli/packages/@eve/eyes/
COPY hestia-cli/packages/@eve/legs/package.json ./hestia-cli/packages/@eve/legs/
COPY hestia-cli/packages/@eve/lifecycle/package.json ./hestia-cli/packages/@eve/lifecycle/
COPY hestia-cli/packages/cli-kit/package.json ./hestia-cli/packages/cli-kit/
COPY hestia-cli/packages/eve-cli/package.json ./hestia-cli/packages/eve-cli/
COPY hestia-cli/packages/eve-dashboard/package.json ./hestia-cli/packages/eve-dashboard/
COPY hestia-cli/packages/install/package.json ./hestia-cli/packages/install/
COPY hestia-cli/packages/types/package.json ./hestia-cli/packages/types/
COPY hestia-cli/packages/usb/package.json ./hestia-cli/packages/usb/
COPY hestia-cli/packages/utils/package.json ./hestia-cli/packages/utils/

# --- synap-backend types (needed for @synap-core/types workspace link) ---
COPY synap-backend/packages/types/package.json ./synap-backend/packages/types/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /workspace

# Reuse installed node_modules from deps
COPY --from=deps /workspace/node_modules ./node_modules
# Reuse installed packages from deps
COPY --from=deps /workspace/packages ./packages

# Now copy full source for the packages we need to build/ship
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# hestia-cli packages (source)
COPY hestia-cli/packages/@eve/dna ./hestia-cli/packages/@eve/dna
COPY hestia-cli/packages/@eve/legs ./hestia-cli/packages/@eve/legs
COPY hestia-cli/packages/@eve/lifecycle ./hestia-cli/packages/@eve/lifecycle
COPY hestia-cli/packages/@eve/brain ./hestia-cli/packages/@eve/brain
COPY hestia-cli/packages/@eve/eyes ./hestia-cli/packages/@eve/eyes
COPY hestia-cli/packages/eve-dashboard ./hestia-cli/packages/eve-dashboard

# @synap-core/types (source — must be built before dashboard)
COPY synap-backend/packages/types ./synap-backend/packages/types

ENV NEXT_TELEMETRY_DISABLED=1

# Build workspace deps in topological order. Order matters:
#   @synap-core/types — no workspace deps (must be built first so dist/ exists)
#   @eve/dna          — no workspace deps
#   @eve/legs         — depends on dna
#   @eve/brain        — depends on dna, legs
#   @eve/eyes         — depends on dna, brain
#   @eve/lifecycle    — depends on dna, legs, brain, eyes
#   @eve/dashboard    — depends on dna, legs, lifecycle
RUN pnpm --filter @synap-core/types run build
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

# Next.js standalone output ships its own minimal node_modules + server.js.
# In a monorepo it preserves the packages/eve-dashboard subpath.
COPY --from=build /workspace/packages/eve-dashboard/.next/standalone ./
COPY --from=build /workspace/packages/eve-dashboard/.next/static ./packages/eve-dashboard/.next/static

# Static assets — Next's standalone tracer only follows JS imports, so
# any .py / template files we read at runtime have to be copied
# explicitly so they land at the path the resolvers probe for them.
#   - @eve/lifecycle/assets    → builder workspace templates
#   - @eve/dna/assets/functions → OpenWebUI Filter Function source files
#                                  pushed via openwebui-functions-sync.ts
COPY --from=build /workspace/packages/@eve/lifecycle/assets ./packages/@eve/lifecycle/assets
COPY --from=build /workspace/packages/@eve/dna/assets ./packages/@eve/dna/assets

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/eve-dashboard/server.js"]