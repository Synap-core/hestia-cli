import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import * as http from 'node:http';
import {
  ensureSynapLoopbackOverride,
  pruneOldImagesForRepo,
  generateKratosConfig,
  parseKratosSecretsFromEnv,
} from '@eve/dna';

export interface SynapImageInstallOptions {
  deployDir?: string;
  domain?: string;
  email?: string;
  adminEmail?: string;
  adminPassword?: string;
  adminBootstrapMode?: 'token' | 'preseed';
}

export interface SynapImageInstallResult {
  bootstrapToken: string;
  deployDir: string;
  containerName: string | null;
}

// Bundled from synap-backend/deploy/docker-compose.yml
const DOCKER_COMPOSE_CONTENT = `# ============================================================================
# SHARED BACKEND ENVIRONMENT
# Used by both \`backend\` (production) and \`backend-canary\` (update validation).
# YAML anchors keep the env vars DRY — add new vars here and both services
# pick them up automatically.
# ============================================================================
x-backend-env: &backend-env
  NODE_ENV: production
  PORT: 4000
  DATABASE_URL: postgresql://synap:\${POSTGRES_PASSWORD}@postgres:5432/synap
  ADMIN_EMAIL: \${ADMIN_EMAIL:-}
  PROVISIONING_TOKEN: \${PROVISIONING_TOKEN:-}
  # CP↔Pod auth: ES256 asymmetric JWT (JWKS). No shared secret needed.
  # Pod fetches {CONTROL_PLANE_URL}/.well-known/jwks.json to verify signatures.
  JWT_SECRET: \${JWT_SECRET}
  KRATOS_PUBLIC_URL: http://kratos:4433
  KRATOS_ADMIN_URL: http://kratos:4434
  KRATOS_SECRETS_COOKIE: \${KRATOS_SECRETS_COOKIE}
  KRATOS_SECRETS_CIPHER: \${KRATOS_SECRETS_CIPHER}
  KRATOS_WEBHOOK_SECRET: \${KRATOS_WEBHOOK_SECRET}
  HYDRA_PUBLIC_URL: http://hydra:4444
  HYDRA_ADMIN_URL: http://hydra:4445
  STORAGE_PROVIDER: minio
  MINIO_ENDPOINT: http://minio:9000
  MINIO_ACCESS_KEY: \${MINIO_ACCESS_KEY}
  MINIO_SECRET_KEY: \${MINIO_SECRET_KEY}
  MINIO_BUCKET: synap-storage
  MINIO_USE_SSL: false
  TYPESENSE_HOST: typesense
  TYPESENSE_PORT: 8108
  TYPESENSE_PROTOCOL: http
  TYPESENSE_API_KEY: \${TYPESENSE_API_KEY}
  TYPESENSE_ADMIN_API_KEY: \${TYPESENSE_ADMIN_API_KEY}
  HUB_PROTOCOL_API_KEY: \${HUB_PROTOCOL_API_KEY:-}
  CHANNEL_GATEWAY_KEY: \${CHANNEL_GATEWAY_KEY:-}
  # Service credential encryption — REQUIRED for CP provisioning.
  # Rotating invalidates stored IS credentials.
  SYNAP_SERVICE_ENCRYPTION_KEY: \${SYNAP_SERVICE_ENCRYPTION_KEY}
  VAULT_SERVER_KEY: \${VAULT_SERVER_KEY:-}
  PUBLIC_URL: \${PUBLIC_URL:-http://backend:4000}
  CONTROL_PLANE_URL: \${CONTROL_PLANE_URL:-}
  OPENAI_API_KEY: \${OPENAI_API_KEY:-}
  ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
  GOOGLE_AI_API_KEY: \${GOOGLE_AI_API_KEY:-}
  ORY_HYDRA_SECRETS_SYSTEM: \${ORY_HYDRA_SECRETS_SYSTEM}
  REALTIME_URL: http://realtime:4001
  HUB_JWT_SECRET: \${HUB_JWT_SECRET:-}
  INTELLIGENCE_HUB_URL: \${INTELLIGENCE_HUB_URL:-}
  INTELLIGENCE_HUB_API_KEY: \${INTELLIGENCE_HUB_API_KEY:-}
  # RSS Feed Provider Configuration
  RSS_PROVIDER_TYPE: \${RSS_PROVIDER_TYPE:-cpproxy}
  RSSHUB_URL: \${RSSHUB_URL:-http://rsshub:1200}
  RSSHUB_ACCESS_KEY: \${RSSHUB_ACCESS_KEY:-}
  CP_RSSHUB_PROXY_URL: \${CP_RSSHUB_PROXY_URL:-}
  RSS_FETCH_TIMEOUT_MS: \${RSS_FETCH_TIMEOUT_MS:-30000}
  RSS_FETCH_RETRIES: \${RSS_FETCH_RETRIES:-3}

services:
  # ============================================================================
  # BACKEND API
  # ============================================================================
  backend:
    image: ghcr.io/\${GITHUB_REPOSITORY:-synap-core/backend}:\${BACKEND_VERSION:-main}
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    restart: always
    environment:
      <<: *backend-env
    volumes:
      # Deploy directory (read-only) so the backend can reference compose file path
      - .:/opt/synap/deploy:ro
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
      backend-migrate:
        condition: service_completed_successfully
    ports:
      - "127.0.0.1:4000:4000"
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "require('http').get('http://localhost:4000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    networks:
      - synap-net

  # ============================================================================
  # BACKEND CANARY (update validation — profile-gated, never in production)
  #
  # Started by update-pod.sh BEFORE the production backend is touched.
  # The canary runs the new image on the same Docker network and is health-
  # checked directly (docker exec → localhost). If it passes, the production
  # backend is recreated with the same image. If it fails, the canary is
  # removed and the running production backend is never touched.
  #
  # This eliminates the "image broken → 5 minutes of 502s before rollback"
  # failure mode. Failed deploys cause zero production downtime.
  #
  # Activated only by: docker compose --profile canary up -d backend-canary
  # Never starts automatically (profile guard + restart: "no").
  # ============================================================================
  backend-canary:
    image: ghcr.io/\${GITHUB_REPOSITORY:-synap-core/backend}:\${BACKEND_VERSION:-main}
    container_name: synap-backend-canary
    restart: "no"
    environment:
      <<: *backend-env
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
    networks:
      - synap-net
    profiles:
      - canary

  # ============================================================================
  # REALTIME SERVER (WebSocket/Socket.IO)
  # Same image as backend — different working directory and entry point
  # ============================================================================
  realtime:
    image: ghcr.io/\${GITHUB_REPOSITORY:-synap-core/backend}:\${BACKEND_VERSION:-main}
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    restart: always
    working_dir: /app/realtime
    command: node dist/server.js
    environment:
      NODE_ENV: production
      REALTIME_PORT: 4001
      FRONTEND_URL: \${FRONTEND_URL:-http://localhost:3000}
      CORS_ORIGIN: \${CORS_ORIGIN:-*}
      DATABASE_URL: postgresql://synap:\${POSTGRES_PASSWORD}@postgres:5432/synap
      STORAGE_PROVIDER: minio
      MINIO_ENDPOINT: http://minio:9000
      MINIO_ACCESS_KEY: \${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: \${MINIO_SECRET_KEY}
      MINIO_BUCKET: synap-storage
      MINIO_USE_SSL: false
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
    ports:
      - "4001:4001"
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "require('http').get('http://localhost:4001/bridge/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    networks:
      - synap-net
    # Ensure proper DNS resolution (Docker's internal DNS can be flaky)
    dns:
      - 127.0.0.11 # Docker's internal DNS

  # ============================================================================
  # CODE MIGRATION SERVICE
  # ============================================================================
  backend-migrate:
    image: ghcr.io/\${GITHUB_REPOSITORY:-synap-core/backend}:\${BACKEND_VERSION:-main}
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    working_dir: /app
    environment:
      DATABASE_URL: postgresql://synap:\${POSTGRES_PASSWORD}@postgres:5432/synap
      HUB_PROTOCOL_API_KEY: \${HUB_PROTOCOL_API_KEY:-}
      HUB_PROTOCOL_API_KEYS: \${HUB_PROTOCOL_API_KEYS:-}
      NODE_ENV: production
    # Run migrations then seed hub protocol API keys in one shot
    # (Merged from former backend-init service to avoid orphaned container issues)
    #
    # IMPORTANT — do not convert this back to a \`command: >\` string form.
    # A string-form command runs as \`/bin/sh -c "<string>"\`, and if the string
    # itself is \`sh -c "INNER"\`, there are TWO shells. The outer shell expands
    # \`$p\` / \`$DB_SCRIPTS\` to empty strings (they aren't set in its env) BEFORE
    # the inner shell ever sees them — producing \`sh: syntax error: unexpected
    # word (expecting "do")\` because the \`for\` loop body references a variable
    # that has been erased.
    #
    # The exec-form list below bypasses Docker's wrapping shell: only ONE \`sh\`
    # runs (the one we invoke explicitly), and \`$$p\` / \`$$DB_SCRIPTS\` become
    # \`$p\` / \`$DB_SCRIPTS\` (after docker-compose processes \`$$\` → \`$\`) when
    # that single shell reads its script. Shell variable expansion then works
    # normally.
    command:
      - sh
      - -c
      - |
        DB_SCRIPTS=''
        for p in \\
          /app/node_modules/@synap/database/dist/scripts \\
          /app/api/node_modules/@synap/database/dist/scripts \\
          node_modules/@synap/database/dist/scripts; do
          if [ -f "$$p/migrate.js" ]; then DB_SCRIPTS="$$p"; break; fi
        done
        if [ -z "$$DB_SCRIPTS" ]; then
          echo '❌ Could not locate @synap/database migration scripts in known paths'
          echo 'Checked: /app/node_modules, /app/api/node_modules, ./node_modules'
          exit 1
        fi
        echo "Using database scripts: $$DB_SCRIPTS"
        node "$$DB_SCRIPTS/migrate.js"
        node "$$DB_SCRIPTS/init-hub-keys.js"
    # One-shot service — runs once and exits. 'no' is correct for standalone Compose
    # (deploy.restart_policy is Docker Swarm only and is ignored here)
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - synap-net

    # ============================================================================
    # POSTGRESQL
    # ============================================================================
  postgres:
    image: timescale/timescaledb-ha:pg15
    restart: always
    environment:
      POSTGRES_USER: synap
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: synap
    volumes:
      - postgres_data:/var/lib/postgresql/data
      # POSTGRES_INIT_SCRIPT selects the init script source:
      #   (unset)   → ../docker/postgres/init-databases.sh  — source-repo deploy
      #   ./config/postgres/init-databases.sh               — install.sh/standalone deploy
      - \${POSTGRES_INIT_SCRIPT:-../docker/postgres/init-databases.sh}:/docker-entrypoint-initdb.d/init-databases.sh
    ports:
      - "5432:5432"
    networks:
      - synap-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U synap"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ============================================================================
  # REDIS
  # ============================================================================
  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    networks:
      - synap-net
    # No public port — Redis only accessible within Docker network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  # ============================================================================
  # MINIO (Object Storage)
  # ============================================================================
  minio:
    image: minio/minio:latest
    restart: always
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: \${MINIO_SECRET_KEY}
    volumes:
      - minio_data:/data
    networks:
      - synap-net
    ports:
      - "9000:9000"
      - "9001:9001"
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "if command -v curl >/dev/null 2>&1; then curl -f http://localhost:9000/minio/health/live >/dev/null; elif command -v wget >/dev/null 2>&1; then wget -q -O - http://localhost:9000/minio/health/live >/dev/null; else exit 0; fi",
        ]
      interval: 30s
      timeout: 20s
      retries: 3

  # ============================================================================
  # TYPESENSE (Search)
  # ============================================================================
  typesense:
    image: typesense/typesense:0.25.2
    restart: always
    command: >
      --data-dir /data
      --api-key=\${TYPESENSE_ADMIN_API_KEY}
      --search-only-api-key=\${TYPESENSE_API_KEY}
      --enable-cors
    volumes:
      - typesense_data:/data
    networks:
      - synap-net
    ports:
      - "8108:8108"
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "timeout 1 bash -c 'cat < /dev/null > /dev/tcp/localhost/8108' || exit 1",
        ]
      interval: 10s
      timeout: 5s
      retries: 3

  # ============================================================================
  # ORY KRATOS (Authentication)
  # ============================================================================
  kratos-migrate:
    image: oryd/kratos:v1.3.1
    deploy:
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 5
    environment:
      DSN: postgres://synap:\${POSTGRES_PASSWORD}@postgres:5432/kratos?sslmode=disable
    command: migrate sql -e --yes
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - synap-net

  kratos:
    image: oryd/kratos:v1.3.1
    restart: always
    environment:
      DSN: postgres://synap:\${POSTGRES_PASSWORD}@postgres:5432/kratos?sslmode=disable
      SECRETS_COOKIE: \${KRATOS_SECRETS_COOKIE}
      SECRETS_CIPHER: \${KRATOS_SECRETS_CIPHER}
      SERVE_PUBLIC_BASE_URL: https://\${DOMAIN}/.ory/kratos/public/
      SERVE_ADMIN_BASE_URL: https://\${DOMAIN}/.ory/kratos/admin/
      # Post-success return URL — must be a route the pod actually serves.
      # The pod admin SPA mounts /admin/ (see apps/admin-ui/src/App.tsx) and
      # Kratos flows are rendered inline at /admin/kratos. There is NO /login
      # route on the pod, so pointing this at /login 404s after every flow.
      SELFSERVICE_DEFAULT_BROWSER_RETURN_URL: https://\${DOMAIN}/admin/
      SELFSERVICE_ALLOWED_RETURN_URLS: https://\${DOMAIN},https://\${DOMAIN}/*
      IDENTITY_SCHEMAS_0_ID: default
      IDENTITY_SCHEMAS_0_URL: file:///etc/config/kratos/identity.schema.json
      DOMAIN: \${DOMAIN}
      KRATOS_WEBHOOK_SECRET: \${KRATOS_WEBHOOK_SECRET}
      # Kratos itself sees only backend-originated traffic (Caddy routes
      # /.ory/kratos/public/* through backend:4000). No external CORS gate
      # needed here — ALLOWED_ORIGINS on the backend is the single source.
    command: ["serve", "-c", "/etc/config/kratos/kratos.yml", "--watch-courier"]
    # Note: --dev flag removed for production security
    # Add --dev back only for local development
    volumes:
      # KRATOS_CONFIG_DIR selects the kratos config source:
      #   (unset)          → ../kratos          — source-repo deploy
      #   ./config/kratos  → install.sh/standalone deploy
      - \${KRATOS_CONFIG_DIR:-../kratos}:/etc/config/kratos
    depends_on:
      kratos-migrate:
        condition: service_completed_successfully
      postgres:
        condition: service_healthy
    ports:
      - "4433:4433"
      - "4434:4434"
    networks:
      - synap-net
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--spider",
          "--quiet",
          "http://localhost:4433/health/ready",
        ]
      interval: 10s
      timeout: 5s
      retries: 5

  # ============================================================================
  # ORY HYDRA (OAuth2)
  # ============================================================================
  hydra-migrate:
    image: oryd/hydra:v2.3.0
    environment:
      DSN: postgres://synap:\${POSTGRES_PASSWORD}@postgres:5432/hydra?sslmode=disable
    command: migrate sql up -e --yes
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - synap-net

  hydra:
    image: oryd/hydra:v2.3.0
    restart: always
    environment:
      DSN: postgres://synap:\${POSTGRES_PASSWORD}@postgres:5432/hydra?sslmode=disable
      URLS_SELF_ISSUER: https://\${DOMAIN}
      URLS_CONSENT: https://\${DOMAIN}/consent
      URLS_LOGIN: https://\${DOMAIN}/login
      SECRETS_SYSTEM: \${ORY_HYDRA_SECRETS_SYSTEM}
    depends_on:
      hydra-migrate:
        condition: service_completed_successfully
      postgres:
        condition: service_healthy
    networks:
      - synap-net
    ports:
      - "4444:4444"
      - "4445:4445"
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--spider",
          "--quiet",
          "http://localhost:4445/health/ready",
        ]
      interval: 10s
      timeout: 5s
      retries: 5

  # ============================================================================
  # CADDY (Reverse Proxy + SSL)
  # ============================================================================
  caddy:
    image: caddy:2-alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      # IMPORTANT: Use absolute path or ensure docker compose is run from deploy/ directory
      # CADDYFILE_PATH selects the Caddyfile variant:
      #   (unset)              → ./Caddyfile        — direct deployment, Caddy manages Let's Encrypt
      #   ./Caddyfile.local    → Cloudflare Tunnel  — auto_https off, serves plain HTTP on port 80
      - \${CADDYFILE_PATH:-./Caddyfile}:/etc/caddy/Caddyfile:ro
      - ./openclaw_auth.snippet:/etc/caddy/openclaw_auth.snippet:ro
      - caddy_data:/data
      - caddy_config:/config
    environment:
      DOMAIN: \${DOMAIN}
      EMAIL: \${LETSENCRYPT_EMAIL}
    networks:
      - synap-net
    depends_on:
      backend:
        condition: service_started
      # Realtime is optional - Caddy should start even if realtime is down
      # This ensures the API still works even if realtime crashes
      realtime:
        condition: service_started # Changed from service_healthy to service_started (less strict)
    dns:
      - 127.0.0.11 # Docker's internal DNS (for container names)
      - 1.1.1.1 # Cloudflare (for external domains like ACME CAs)
      - 8.8.8.8 # Google (fallback)

  # ============================================================================
  # OPENCLAW (opt-in — managed via control plane /openclaw/provision)
  #
  # For cloud-managed pods: activated automatically by the CP provisioning flow.
  # For self-hosted: fill in SYNAP_* vars in /opt/synap/.env, then run:
  #   docker compose --profile openclaw up -d openclaw
  #   openclaw skill install https://raw.githubusercontent.com/synap-app/synap-backend/main/skills/synap-os/SKILL.md
  #
  # Environment variables injected by the provisioning flow:
  #   OPENCLAW_HUB_API_KEY  — Hub Protocol key bound to the OpenClaw agent user
  #   SYNAP_AGENT_USER_ID   — Agent user ID for attribution and RBAC on the pod
  #   SYNAP_WORKSPACE_ID    — Workspace the agent is scoped to
  # ============================================================================
  openclaw:
    container_name: openclaw
    image: ghcr.io/openclaw/openclaw:latest
    restart: unless-stopped
    volumes:
      - openclaw_config:/root/.openclaw
      - openclaw_workspace:/root/openclaw/workspace
    environment:
      - SYNAP_POD_URL=\${SYNAP_POD_URL:-http://backend:4000}
      - SYNAP_HUB_API_KEY=\${OPENCLAW_HUB_API_KEY} # Hub Protocol key (injected by provisioning flow)
      - SYNAP_AGENT_USER_ID=\${SYNAP_AGENT_USER_ID} # Agent user ID for Hub Protocol attribution
      - SYNAP_WORKSPACE_ID=\${SYNAP_WORKSPACE_ID} # Workspace scope for this agent
      - OPENCLAW_MODEL=anthropic/claude-sonnet-4-6 # AI model
      - ANTHROPIC_API_KEY=\${ANTHROPIC_API_KEY} # Required for the model above
    ports:
      - "18789:18789" # OpenClaw gateway — SSH health checks use localhost:18789
    networks:
      - synap-net
    profiles:
      - openclaw

  # ============================================================================
  # RSSHUB — Optional RSS aggregation service
  # Start with: docker compose --profile rsshub up -d
  # ============================================================================
  rsshub:
    image: diygod/rsshub:latest
    container_name: \${COMPOSE_PROJECT_NAME:-synap}-rsshub
    restart: unless-stopped
    ports:
      - "1200:1200"
    environment:
      - NODE_ENV=production
      - CACHE_TYPE=redis
      - REDIS_URL=redis://redis:6379
      - PUPPETEER_WS_ENDPOINT=ws://browserless:3000
      - ACCESS_KEY=\${RSSHUB_ACCESS_KEY:-}
    depends_on:
      - redis
      - browserless
    profiles:
      - rsshub
    networks:
      - synap-net
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:1200/"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  # ============================================================================
  # BROWSERLESS — Chrome headless for RSSHub Puppeteer support
  # ============================================================================
  browserless:
    image: browserless/chrome:latest
    container_name: \${COMPOSE_PROJECT_NAME:-synap}-browserless
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - MAX_CONCURRENT_SESSIONS=10
      - CONNECTION_TIMEOUT=60000
      - MAX_QUEUE_LENGTH=20
    profiles:
      - rsshub
    networks:
      - synap-net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/readiness"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ============================================================================
  # MONITORING — Dozzle log viewer (optional)
  # Enable with: docker compose --profile monitoring up -d
  # ============================================================================
  dozzle:
    container_name: dozzle
    image: amir20/dozzle:latest
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    ports:
      - "8888:8080"
    networks:
      - synap-net
    profiles:
      - monitoring

  # ============================================================================
  # PROMETHEUS — Metrics scraping + alerting rules (optional)
  # Enable with: docker compose --profile monitoring up -d
  # ============================================================================
  prometheus:
    image: prom/prometheus:v2.51.0
    profiles: ["monitoring"]
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/alerts.yml:/etc/prometheus/alerts.yml:ro
      - prometheus-data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=15d"
    ports:
      - "9090:9090"
    networks:
      - synap-net
    restart: unless-stopped

  # ============================================================================
  # GRAFANA — Metrics dashboards (optional)
  # ============================================================================
  grafana:
    image: grafana/grafana:10.4.0
    profiles: ["monitoring"]
    volumes:
      - grafana-data:/var/lib/grafana
      - ./monitoring/grafana-dashboard.json:/etc/grafana/provisioning/dashboards/synap.json:ro
    environment:
      GF_SECURITY_ADMIN_PASSWORD: \${GRAFANA_PASSWORD:-admin}
      GF_USERS_ALLOW_SIGN_UP: "false"
    ports:
      - "3333:3000"
    networks:
      - synap-net
    depends_on: [prometheus]
    restart: unless-stopped

  # ============================================================================
  # ALERTMANAGER — Alert routing (Slack, PagerDuty, etc.) (optional)
  # ============================================================================
  alertmanager:
    image: prom/alertmanager:v0.27.0
    profiles: ["monitoring"]
    volumes:
      - ./monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
    ports:
      - "9093:9093"
    networks:
      - synap-net
    restart: unless-stopped

  # ============================================================================
  # CLOUDFLARE TUNNEL (optional, exposure provider profile)
  # Activated by pod-agent configure with profile: cloudflare-tunnel
  # ============================================================================
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token \${CLOUDFLARED_TUNNEL_TOKEN}
    environment:
      - TUNNEL_TOKEN=\${CLOUDFLARED_TUNNEL_TOKEN:-}
    networks:
      - synap-net
    profiles:
      - cloudflare-tunnel

  # ============================================================================
  # PANGOLIN TUNNEL (optional, SELF-HOSTED ONLY)
  #
  # Unlike the cloudflare-tunnel profile above, this is NOT driven by the Synap
  # Control Plane. Pangolin is self-hosted only: the operator runs their own
  # Pangolin server (github.com/fosrl/pangolin) and pastes a Newt site-
  # connector token (PANGOLIN_ENDPOINT / NEWT_ID / NEWT_SECRET) into this pod's
  # .env. There is no CP-side \`pangolin_tunnel\` exposure mode — see migration
  # drizzle/0026_remove_pangolin_exposure_mode.sql on the control plane side.
  #
  # This profile is intentionally a placeholder until the self-hosted CLI work
  # (\`./synap tunnel enable pangolin --token <NEWT_TOKEN>\`) swaps in a real
  # \`fosrl/newt\` container. Activating the profile today just keeps the
  # compose profile name stable so existing .env files and install scripts
  # don't break.
  # ============================================================================
  pangolin-tunnel:
    image: alpine:3.20
    restart: unless-stopped
    command:
      [
        "/bin/sh",
        "-c",
        "echo 'pangolin tunnel profile active (self-hosted placeholder)'; sleep infinity",
      ]
    networks:
      - synap-net
    profiles:
      - pangolin-tunnel

  # ============================================================================
  # POD AGENT (always-running command receiver for CP-initiated operations)
  # ============================================================================
  pod-agent:
    build:
      context: ./pod-agent
      dockerfile: Dockerfile
    # Published by .github/workflows/docker-publish.yml (job build-and-push-pod-agent).
    # Local dev: \`docker compose build pod-agent\` still tags this image name.
    image: ghcr.io/synap-core/pod-agent:\${POD_AGENT_VERSION:-latest}
    restart: always
    environment:
      POD_AGENT_PORT: 4002
      DEPLOY_DIR: /deploy
      HOST_LOG_DIR: /host-log
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - .:/deploy:rw
      # Host /var/log mounted read-only so the agent can serve install /
      # cloud-init logs to the Control Plane dashboard (allowlisted files
      # only — see server.js HOST_LOG_ALLOWLIST). Read-only is critical:
      # a compromised CP JWT should never be able to tamper with host logs.
      - /var/log:/host-log:ro
    ports:
      - "4002:4002"
    networks:
      - synap-net
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "require('http').get('http://localhost:4002/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  # ============================================================================
  # POD SELF-UPDATER (one-shot, spawned by update-pod.sh via pod-agent)
  # ============================================================================
  updater:
    image: docker:cli
    restart: "no"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - .:/deploy:rw
    working_dir: /deploy
    entrypoint: ["/bin/sh", "/deploy/update-pod.sh"]
    networks:
      - synap-net
    profiles:
      - updater

volumes:
  postgres_data:
  redis_data:
  minio_data:
  typesense_data:
  caddy_data:
  caddy_config:
  openclaw_config:
  openclaw_workspace:
  prometheus-data:
  grafana-data:

networks:
  synap-net:
    driver: bridge
`;

// Bundled from synap-backend/docker/postgres/init-databases.sh
const POSTGRES_INIT_SCRIPT_CONTENT = `#!/bin/bash
set -e

echo "🔄 Initializing Synap databases..."

# Create application database if it doesn't exist
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Check and create synap database
    SELECT 'CREATE DATABASE synap'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'synap')\\gexec
    
    -- Check and create kratos database (Ory Kratos)
    SELECT 'CREATE DATABASE kratos'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kratos')\\gexec
    
    -- Check and create hydra database (Ory Hydra)
    SELECT 'CREATE DATABASE hydra'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hydra')\\gexec

    -- Check and create synap_test database
    SELECT 'CREATE DATABASE synap_test'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'synap_test')\\gexec
EOSQL

# Connect to synap database and enable extensions
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "synap" <<-EOSQL
    -- Enable required extensions
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    
    -- Create migrations tracking table
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    -- Log success
    SELECT 'Synap database initialized with extensions' AS status;
EOSQL

# Connect to synap_test database and enable extensions (identical setup)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "synap_test" <<-EOSQL
    -- Enable required extensions
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    
    -- Create migrations tracking table
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    -- Log success
    SELECT 'Synap Test database initialized with extensions' AS status;
EOSQL

echo "✅ Synap databases created successfully!"
`;

function gen(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function generateEnv(opts: Required<SynapImageInstallOptions> & { bootstrapToken: string }): string {
  const publicUrl = opts.domain === 'localhost'
    ? 'http://localhost:4000'
    : `https://${opts.domain}`;

  return [
    '# Synap Data Pod — generated by Eve CLI',
    `GITHUB_REPOSITORY=synap-core/backend`,
    `BACKEND_VERSION=main`,
    `COMPOSE_PROJECT_NAME=synap-backend`,
    '',
    `DOMAIN=${opts.domain}`,
    `LETSENCRYPT_EMAIL=${opts.email}`,
    `PUBLIC_URL=${publicUrl}`,
    '',
    `ADMIN_EMAIL=${opts.adminEmail}`,
    `ADMIN_BOOTSTRAP_MODE=${opts.adminBootstrapMode}`,
    `ADMIN_BOOTSTRAP_TOKEN=${opts.bootstrapToken}`,
    '',
    `POSTGRES_PASSWORD=${gen()}`,
    `JWT_SECRET=${gen()}`,
    `KRATOS_SECRETS_COOKIE=${gen()}`,
    `KRATOS_SECRETS_CIPHER=${gen(16)}`,
    `KRATOS_WEBHOOK_SECRET=${gen()}`,
    `MINIO_ACCESS_KEY=minio-${gen(8)}`,
    `MINIO_SECRET_KEY=${gen()}`,
    `TYPESENSE_API_KEY=${gen(16)}`,
    `TYPESENSE_ADMIN_API_KEY=${gen(16)}`,
    `ORY_HYDRA_SECRETS_SYSTEM=${gen()}`,
    `SYNAP_SERVICE_ENCRYPTION_KEY=${gen()}`,
    `HUB_JWT_SECRET=${gen()}`,
    // PROVISIONING_TOKEN is the shared secret that lets the Eve CLI mint
    // per-agent Hub keys against /api/hub/setup/agent. Without this Eve
    // can't auto-provision agents on first run — agents page and intents
    // page would 401 forever. Mint it here so first install just works.
    `PROVISIONING_TOKEN=${gen()}`,
    '',
    'INTELLIGENCE_HUB_URL=',
    'INTELLIGENCE_HUB_API_KEY=',
    '',
    'RSS_PROVIDER_TYPE=self-hosted',
    'RSSHUB_URL=http://eve-eyes-rsshub:1200',
    '',
    'POSTGRES_INIT_SCRIPT=./config/postgres/init-databases.sh',
    'KRATOS_CONFIG_DIR=./config/kratos',
    'EMBEDDING_PROVIDER=deterministic',
    'ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000',
  ].join('\n');
}

function parseEnvValue(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m?.[1]?.trim() ?? '';
}

function run(args: string[], cwd: string): void {
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, COMPOSE_PROJECT_NAME: 'synap-backend' },
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${args.join(' ')}`);
  }
}

function getSynapBackendContainer(): string | null {
  try {
    const out = execSync(
      'docker ps --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=backend" --format "{{.Names}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    return out.split('\n')[0]?.trim() || null;
  } catch {
    return null;
  }
}

function connectToEveNetwork(containerName: string): void {
  try {
    execSync(`docker network connect eve-network ${containerName}`, {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    // Already connected — fine
  }
}

function isKratosRunning(_deployDir: string): boolean {
  try {
    const out = execSync(
      'docker ps --filter "label=com.docker.compose.project=synap-backend" --filter "label=com.docker.compose.service=kratos" --format "{{.Names}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

function probeKratosHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:4433/health/ready', (res) => {
      resolve(res.statusCode === 200);
    });
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function waitForKratosHealthy(maxWaitMs = 120_000): Promise<boolean> {
  const start = Date.now();
  process.stdout.write('  Waiting for Kratos to be ready');
  while (Date.now() - start < maxWaitMs) {
    if (await probeKratosHealth()) {
      process.stdout.write(' ✓\n');
      return true;
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 3000));
  }
  process.stdout.write(' (timed out)\n');
  return false;
}

/**
 * Ensure Kratos is running. Called from provision/setup flows that need
 * to create identities via the Kratos admin API. Idempotent — no-op if
 * Kratos is already up and healthy.
 *
 * Runs migrations explicitly via `compose run --rm` (avoids the ambiguous
 * `condition: service_completed_successfully` behaviour when a restart
 * policy is present), then starts kratos with `--no-deps`.
 */
export async function ensureKratosRunning(deployDir: string, domain: string): Promise<void> {
  if (isKratosRunning(deployDir) && await probeKratosHealth()) return;

  const envPath = join(deployDir, '.env');
  if (!existsSync(envPath)) {
    throw new Error(`No .env found at ${deployDir} — run \`eve install\` first.`);
  }

  let envContent = readFileSync(envPath, 'utf-8');
  const postgresPassword = parseEnvValue(envContent, 'POSTGRES_PASSWORD');

  // Ensure KRATOS_CONFIG_DIR is set in .env
  if (!envContent.includes('KRATOS_CONFIG_DIR=')) {
    const sep = envContent.endsWith('\n') ? '' : '\n';
    envContent = `${envContent}${sep}KRATOS_CONFIG_DIR=./config/kratos\n`;
    writeFileSync(envPath, envContent, { encoding: 'utf-8', mode: 0o600 });
  }

  // Write kratos.yml + identity.schema.json
  await generateKratosConfig(deployDir, domain, postgresPassword, parseKratosSecretsFromEnv(envContent), 'http://backend:4000');

  const composeEnv = { ...process.env, COMPOSE_PROJECT_NAME: 'synap-backend' };

  // Run kratos-migrate explicitly — one-shot, no restart-policy ambiguity
  console.log('  Running Kratos DB migrations…');
  const migrateResult = spawnSync('docker', ['compose', 'run', '--rm', 'kratos-migrate'], {
    cwd: deployDir, stdio: 'inherit', env: composeEnv,
  });
  if (migrateResult.status !== 0) {
    throw new Error('Kratos DB migration failed — check `docker compose logs kratos-migrate`');
  }

  // Start kratos with --no-deps (migration already done above)
  console.log('  Starting Kratos…');
  const upResult = spawnSync('docker', ['compose', 'up', '-d', '--no-deps', 'kratos'], {
    cwd: deployDir, stdio: 'inherit', env: composeEnv,
  });
  if (upResult.status !== 0) {
    throw new Error('Failed to start Kratos — check `docker compose logs kratos`');
  }

  const healthy = await waitForKratosHealthy(90_000);
  if (!healthy) {
    throw new Error('Kratos did not become healthy in time — check `docker compose logs kratos`');
  }
}

export async function installSynapFromImage(opts: SynapImageInstallOptions = {}): Promise<SynapImageInstallResult> {
  const deployDir = opts.deployDir ?? '/opt/synap-backend';
  const domain = opts.domain ?? 'localhost';
  const email = opts.email ?? '';
  const adminEmail = opts.adminEmail ?? '';
  const adminBootstrapMode = opts.adminBootstrapMode ?? 'token';

  // 1. Scaffold deploy directory
  mkdirSync(deployDir, { recursive: true });
  const pgInitDir = join(deployDir, 'config', 'postgres');
  mkdirSync(pgInitDir, { recursive: true });

  // 2. Write bundled files (always refresh compose + init script; never touch .env)
  writeFileSync(join(deployDir, 'docker-compose.yml'), DOCKER_COMPOSE_CONTENT, 'utf-8');
  writeFileSync(join(pgInitDir, 'init-databases.sh'), POSTGRES_INIT_SCRIPT_CONTENT, { encoding: 'utf-8', mode: 0o755 });
  console.log(`  Written deploy files to ${deployDir}`);

  // 2b. Publish a loopback-only host port (127.0.0.1:4000 → backend:4000)
  // via Compose's official extension hook. The on-host CLI then talks
  // to the API without going through Traefik / public DNS / TLS — same
  // protocol, just a different (faster, no-cert-needed) base URL. The
  // helper preserves user-owned override files via marker detection;
  // failures are non-fatal (CLI just falls back to the public URL).
  try {
    const r = ensureSynapLoopbackOverride(deployDir);
    if (r.outcome === 'wrote') {
      console.log(`  Wrote loopback compose override at ${r.path}`);
    } else {
      console.log(`  Kept existing ${r.path} (${r.reason ?? 'user-owned'})`);
    }
  } catch (err) {
    console.warn(`  Could not write loopback override: ${err instanceof Error ? err.message : String(err)} (continuing — CLI will use public URL)`);
  }

  // 3. Generate or update .env
  const envPath = join(deployDir, '.env');
  let bootstrapToken: string;
  if (!existsSync(envPath)) {
    bootstrapToken = gen(16);
    const envContent = generateEnv({ deployDir, domain, email, adminEmail, adminPassword: opts.adminPassword ?? '', adminBootstrapMode, bootstrapToken });
    writeFileSync(envPath, envContent, { encoding: 'utf-8', mode: 0o600 });
    console.log('  Generated .env with random secrets');
  } else {
    console.log('  Existing .env preserved — reusing secrets');
    let existing = readFileSync(envPath, 'utf-8');

    // Always ensure BACKEND_VERSION is current — old installs may have written "latest"
    if (/^BACKEND_VERSION=(?!main$)/m.test(existing)) {
      existing = existing.replace(/^BACKEND_VERSION=.*/m, 'BACKEND_VERSION=main');
      writeFileSync(envPath, existing, { encoding: 'utf-8', mode: 0o600 });
      console.log('  Updated BACKEND_VERSION → main');
    }

    // Self-heal PROVISIONING_TOKEN. Old installs that ran before this var
    // was generated will have either no line at all or a placeholder
    // `PROVISIONING_TOKEN=` from copying .env.example. Either way Eve
    // can't mint agent keys without it — fix in place, idempotently.
    let provisioningTokenChanged = false;
    const tokenMatch = existing.match(/^PROVISIONING_TOKEN=(.*)$/m);
    if (!tokenMatch || tokenMatch[1].trim() === '') {
      const newToken = gen();
      if (tokenMatch) {
        existing = existing.replace(/^PROVISIONING_TOKEN=.*$/m, `PROVISIONING_TOKEN=${newToken}`);
      } else {
        // Append; preserve trailing newline
        const sep = existing.endsWith('\n') ? '' : '\n';
        existing = `${existing}${sep}PROVISIONING_TOKEN=${newToken}\n`;
      }
      writeFileSync(envPath, existing, { encoding: 'utf-8', mode: 0o600 });
      provisioningTokenChanged = true;
      console.log('  Generated PROVISIONING_TOKEN (was missing/empty — Eve can now mint agent keys)');
    }

    // Reuse the existing bootstrap token so it stays consistent with what's seeded in the DB
    const m = existing.match(/^ADMIN_BOOTSTRAP_TOKEN=(.+)$/m);
    bootstrapToken = m?.[1] ?? gen(16);

    // Self-heal KRATOS_CONFIG_DIR — old installs never had this var.
    if (!existing.includes('KRATOS_CONFIG_DIR=')) {
      const sep = existing.endsWith('\n') ? '' : '\n';
      existing = `${existing}${sep}KRATOS_CONFIG_DIR=./config/kratos\n`;
      writeFileSync(envPath, existing, { encoding: 'utf-8', mode: 0o600 });
      console.log('  Added KRATOS_CONFIG_DIR=./config/kratos (was missing)');
    }

    // If the backend is already running, nothing to do — UNLESS we just
    // self-healed PROVISIONING_TOKEN, in which case the running backend
    // is holding the stale (empty) value. Recreate it so the new env
    // lands. `compose up -d backend` is a no-op when nothing changed.
    const runningContainer = getSynapBackendContainer();
    if (runningContainer) {
      if (provisioningTokenChanged) {
        console.log('  Recreating backend so it picks up the new PROVISIONING_TOKEN…');
        spawnSync('docker', ['compose', 'up', '-d', 'backend'], {
          cwd: deployDir, stdio: 'inherit',
          env: { ...process.env, COMPOSE_PROJECT_NAME: 'synap-backend' },
        });
      }
      return { bootstrapToken, deployDir, containerName: runningContainer };
    }
    // Container not running — fall through to pull + start (preserving the existing secrets)
    console.log('  Backend not running — resuming install...');
  }

  // 3b. Generate Kratos config files (kratos.yml + identity.schema.json)
  {
    const envContent = readFileSync(envPath, 'utf-8');
    const postgresPassword = parseEnvValue(envContent, 'POSTGRES_PASSWORD');
    try {
      await generateKratosConfig(deployDir, domain, postgresPassword, parseKratosSecretsFromEnv(envContent), 'http://backend:4000');
      console.log('  Generated Kratos config files');
    } catch (err) {
      console.warn(`  Could not generate Kratos config: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Pull backend image (backend + backend-migrate + realtime all use the same image;
  //    pull explicitly so Docker doesn't reuse a stale cached layer)
  console.log('  Pulling backend image (ghcr.io/synap-core/backend:main)...');
  spawnSync('docker', ['compose', 'pull', 'backend', 'backend-migrate', 'realtime', '--ignore-pull-failures'], {
    cwd: deployDir, stdio: 'inherit',
    env: { ...process.env, COMPOSE_PROJECT_NAME: 'synap-backend', BACKEND_VERSION: 'main' },
  });

  // 5. Bring up backend + realtime. Compose resolves infra dependencies
  //    (postgres/redis/minio/typesense) and runs backend-migrate automatically.
  //    Caddy, Hydra, pod-agent, and profile-gated services are excluded.
  console.log('  Starting backend and realtime (compose handles infra + migrations)...');
  run(['docker', 'compose', 'up', '-d', 'backend', 'realtime'], deployDir);

  // 6. Start Kratos. Run the migration one-shot explicitly to avoid the
  //    ambiguous condition:service_completed_successfully behaviour when
  //    kratos-migrate has a deploy.restart_policy.
  console.log('  Running Kratos DB migrations...');
  run(['docker', 'compose', 'run', '--rm', 'kratos-migrate'], deployDir);
  console.log('  Starting Kratos...');
  run(['docker', 'compose', 'up', '-d', '--no-deps', 'kratos'], deployDir);

  // 7. Connect to eve-network so Traefik can route to it
  let containerName: string | null = null;
  for (let i = 0; i < 10; i++) {
    containerName = getSynapBackendContainer();
    if (containerName) break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (containerName) {
    connectToEveNetwork(containerName);
    console.log(`  Connected ${containerName} → eve-network`);
  }

  // 8. Reclaim disk by pruning old image versions. The new container
  // is up by now, so its image is protected (rmi refuses in-use). Older
  // tags are removed; the latest 3 are kept for rollback. Failures are
  // non-fatal — disk reclamation is opportunistic, never blocks install.
  for (const repo of ['ghcr.io/synap-core/backend', 'ghcr.io/synap-core/pod-agent']) {
    try {
      const r = pruneOldImagesForRepo(repo, 3);
      if (r.removed.length > 0) {
        console.log(`  Pruned ${r.removed.length} old ${repo} image(s) (kept latest 3).`);
      }
    } catch {
      // Ignore — `docker images` may not be available in some sandbox
      // environments; the next `eve update` will retry.
    }
  }

  return { bootstrapToken, deployDir, containerName };
}
