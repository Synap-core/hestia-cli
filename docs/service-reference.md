# Service Reference

Complete reference for all Eve entity services.

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────────┐
│                        🧠 BRAIN (Intelligence)                       │
├─────────────────────────────────────────────────────────────────────┤
│ Synap        │ ghcr.io/synap/backend:latest │ :4000 │ Core API    │
│ Ollama       │ ollama/ollama:latest         │ :11434│ AI Engine   │
│ PostgreSQL   │ postgres:16-alpine           │ :5432 │ Memory      │
│ Redis        │ redis:7-alpine               │ :6379 │ Cache       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        🦾 ARMS (Actions)                             │
├─────────────────────────────────────────────────────────────────────┤
│ OpenClaw     │ ghcr.io/openclaw/openclaw:latest │ :3000 │ MCP       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        🏗️ BUILDER (Creation)                         │
├─────────────────────────────────────────────────────────────────────┤
│ OpenCode     │ npm: @opencode/cli        │ CLI   │ Code gen      │
│ OpenClaude   │ npm: @openclaude/cli      │ CLI   │ AI coding     │
│ Dokploy      │ npm: dokploy              │ CLI   │ Deployment    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        👁️ EYES (Perception)                          │
├─────────────────────────────────────────────────────────────────────┤
│ RSSHub       │ rsshub/rsshub:latest     │ :1200 │ Feeds         │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        🦿 LEGS (Exposure)                            │
├─────────────────────────────────────────────────────────────────────┤
│ Traefik      │ traefik:v3.0             │ :80   │ Routing       │
│              │                          │ :443  │ SSL           │
│              │                          │ :8080 │ Dashboard     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🧠 Brain Services

### Synap Backend

**Purpose**: Core API and intelligence coordination

**Image**: `ghcr.io/synap/backend:latest` (or `synap/backend:latest`)

**Container**: `eve-brain-synap`

**Ports**:
- `4000` - Main API

**Environment Variables**:
```bash
NODE_ENV=production
DATABASE_URL=postgresql://hestia:hestia@hestia-brain-postgres:5432/synap
REDIS_URL=redis://hestia-brain-redis:6379
JWT_SECRET=<64-char-hex>
HUB_PROTOCOL_API_KEY=<64-char-hex>
SYNAP_SERVICE_ENCRYPTION_KEY=<64-char-hex>
HUB_JWT_SECRET=<64-char-hex>
SESSION_SECRET=<64-char-hex>
```

**Volumes**:
- None (stateless, uses PostgreSQL)

**Health Check**:
```bash
curl http://localhost:4000/health
```

**Dependencies**:
- PostgreSQL (must be healthy)
- Redis (must be healthy)

**Network**: `hestia-network`

---

### Ollama

**Purpose**: Local AI model inference

**Image**: `ollama/ollama:latest`

**Container**: `hestia-brain-ollama`

**Ports**:
- `11434` - API endpoint

**Environment Variables**:
```bash
# None required - Ollama is self-contained
```

**Volumes**:
- `ollama-models:/root/.ollama` - Model storage

**Health Check**:
```bash
curl http://localhost:11434/api/tags
```

**Model Management**:
```bash
# Pull a model
docker exec hestia-brain-ollama ollama pull llama3.2

# List models
docker exec hestia-brain-ollama ollama list

# Remove a model
docker exec hestia-brain-ollama ollama rm llama3.2
```

**Network**: `hestia-network`

---

### PostgreSQL

**Purpose**: Long-term memory and data persistence

**Image**: `postgres:16-alpine`

**Container**: `hestia-brain-postgres`

**Ports**:
- `5432` - Database (internal only recommended)

**Environment Variables**:
```bash
POSTGRES_USER=hestia
POSTGRES_PASSWORD=hestia  # Change in production!
POSTGRES_DB=synap
PGDATA=/var/lib/postgresql/data/pgdata
```

**Volumes**:
- `hestia-brain-postgres-data:/var/lib/postgresql/data`

**Health Check**:
```bash
docker exec hestia-brain-postgres pg_isready -U hestia
```

**Backup**:
```bash
# Backup
docker exec hestia-brain-postgres pg_dump -U hestia synap > backup.sql

# Restore
cat backup.sql | docker exec -i hestia-brain-postgres psql -U hestia synap
```

**Network**: `hestia-network`

---

### Redis

**Purpose**: Working memory, cache, sessions

**Image**: `redis:7-alpine`

**Container**: `hestia-brain-redis`

**Ports**:
- `6379` - Redis (internal only recommended)

**Environment Variables**:
```bash
# None required
```

**Command**:
```
redis-server --appendonly yes
```

**Volumes**:
- `hestia-brain-redis-data:/data`

**Health Check**:
```bash
docker exec hestia-brain-redis redis-cli ping
# Should return PONG
```

**Persistence**: AOF (Append Only File) enabled for durability

**Network**: `hestia-network`

---

## 🦾 Arms Services

### OpenClaw

**Purpose**: AI-powered action execution via MCP

**Image**: `ghcr.io/openclaw/openclaw:latest`

**Container**: `hestia-arms-openclaw`

**Ports**:
- `3000` - Web UI and API

**Environment Variables**:
```bash
OLLAMA_URL=http://hestia-brain-ollama:11434
DEFAULT_MODEL=llama3.2
CONFIG_PATH=/data/config.json
```

**Volumes**:
- `hestia-arms-openclaw-data:/data`

**Configuration** (`/data/config.json`):
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data/workspace"]
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://hestia:hestia@hestia-brain-postgres:5432/synap"]
    }
  }
}
```

**Health Check**:
```bash
curl http://localhost:3000/health
```

**Dependencies**:
- Ollama (for AI inference)
- PostgreSQL (optional, for data access)

**Network**: `hestia-network`

---

## 🏗️ Builder Services

### OpenCode

**Purpose**: Code and content generation

**Type**: CLI Tool (Node.js)

**Installation**:
```bash
npm install -g @opencode/cli
```

**Configuration** (`~/.config/opencode/config.json`):
```json
{
  "brainUrl": "http://localhost:11434",
  "model": "llama3.2",
  "temperature": 0.7,
  "maxTokens": 2048
}
```

**Usage**:
```bash
# Generate a website
opencode generate website --template portfolio

# Create documentation
opencode generate docs --from ./src

# Scaffold a project
opencode scaffold --type nextjs --name my-app
```

**Note**: OpenCode connects to Ollama on `localhost:11434` from host context.

---

### OpenClaude

**Purpose**: AI-assisted software development

**Type**: CLI Tool (Node.js)

**Installation**:
```bash
npm install -g @openclaude/cli
```

**Configuration** (`~/.config/openclaude/config.json`):
```json
{
  "brainUrl": "http://localhost:11434",
  "model": "llama3.2",
  "editor": "cursor",
  "autoApply": false
}
```

**Usage**:
```bash
# Start a coding session
openclaude session --project ./my-project

# Generate code from description
openclaude generate "Create a React component for a user profile"

# Review code
openclaude review --file ./src/app.ts
```

---

### Dokploy

**Purpose**: Deployment and infrastructure management

**Type**: CLI Tool (Node.js) + Optional Server

**Installation**:
```bash
npm install -g dokploy
```

**Configuration**:
```json
{
  "server": {
    "host": "localhost",
    "port": 3000
  },
  "git": {
    "provider": "github",
    "token": "ghp_..."
  },
  "docker": {
    "registry": "ghcr.io",
    "username": "your-username"
  }
}
```

**Usage**:
```bash
# Deploy a project
dokploy deploy --project my-app

# Create a new project
dokploy project create --name my-app --template nodejs

# View logs
dokploy logs --project my-app
```

**Note**: Dokploy can self-host or use cloud service.

---

## 👁️ Eyes Services

### RSSHub

**Purpose**: RSS feed generation from web sources

**Image**: `rsshub/rsshub:latest`

**Container**: `hestia-eyes-rsshub`

**Ports**:
- `1200` - RSS feeds

**Environment Variables**:
```bash
# Optional: Access tokens for private feeds
GITHUB_TOKEN=<token>
TWITTER_TOKEN=<token>
YOUTUBE_API_KEY=<key>
```

**Volumes**:
- None (stateless)

**Health Check**:
```bash
curl http://localhost:1200
```

**Feed Examples**:
```
# GitHub user repos
http://localhost:1200/github/repos/username

# Twitter user
http://localhost:1200/twitter/user/username

# YouTube channel
http://localhost:1200/youtube/channel/channel-id

# Reddit
http://localhost:1200/reddit/r/technology

# Hacker News
http://localhost:1200/hackernews
```

**Network**: `hestia-network`

---

## 🦿 Legs Services

### Traefik

**Purpose**: Reverse proxy and SSL termination

**Image**: `traefik:v3.0`

**Container**: `hestia-legs-traefik`

**Ports**:
- `80` - HTTP (redirects to HTTPS)
- `443` - HTTPS
- `8080` - Dashboard (internal only)

**Environment Variables**:
```bash
# None - configured via files
```

**Volumes**:
- `/var/run/docker.sock:/var/run/docker.sock:ro` - Docker discovery
- `hestia-legs-traefik-certs:/etc/traefik/acme.json` - SSL certificates
- `/opt/hestia/legs/traefik.yml:/etc/traefik/traefik.yml` - Static config
- `/opt/hestia/legs/dynamic:/etc/traefik/dynamic` - Dynamic configs

**Static Config** (`traefik.yml`):
```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@your-domain.com
      storage: /etc/traefik/acme.json
      tlsChallenge: {}

providers:
  docker:
    exposedByDefault: false
    network: hestia-network
  file:
    directory: /etc/traefik/dynamic
    watch: true

api:
  dashboard: true
  insecure: true  # Only for localhost access

log:
  level: INFO
```

**Dynamic Config Example** (`dynamic/synap.yml`):
```yaml
http:
  routers:
    synap:
      rule: "Host(`api.your-domain.com`)"
      service: synap
      tls:
        certResolver: letsencrypt
  
  services:
    synap:
      loadBalancer:
        servers:
          - url: "http://hestia-brain-synap:4000"
```

**Health Check**:
```bash
curl http://localhost:8080/api/rawdata
```

**Dashboard**: http://localhost:8080/dashboard/

**Network**: `hestia-network`

---

## Network Architecture

### Docker Networks

```yaml
# Primary network - all services
hestia-network:
  driver: bridge
  ipam:
    config:
      - subnet: 172.20.0.0/16
```

### Service Discovery

Within `hestia-network`, services can reach each other by container name:

```
hestia-brain-synap:4000
hestia-brain-ollama:11434
hestia-brain-postgres:5432
hestia-brain-redis:6379
hestia-arms-openclaw:3000
hestia-eyes-rsshub:1200
hestia-legs-traefik:80
```

### External Access

| Service | External URL | Via Traefik |
|---------|--------------|-------------|
| Synap API | `https://api.your-domain.com` | Yes |
| OpenClaw | `https://ai.your-domain.com` | Yes |
| RSSHub | `https://feeds.your-domain.com` | Yes |
| Traefik Dashboard | `https://traefik.your-domain.com` | Yes |
| Ollama | No external access | No (internal only) |
| PostgreSQL | No external access | No (internal only) |
| Redis | No external access | No (internal only) |

---

## Environment Variable Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Main domain | `eve.example.com` |
| `LETSENCRYPT_EMAIL` | SSL cert email | `admin@example.com` |
| `POSTGRES_PASSWORD` | DB password | `<random-32-char>` |
| `JWT_SECRET` | Auth signing key | `<random-64-char-hex>` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_MODEL` | Default AI model | `llama3.2` |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `SYNAP_PORT` | Synap API port | `4000` |
| `OLLAMA_PORT` | Ollama port | `11434` |

### Secret Generation

```bash
# Generate secure secrets
POSTGRES_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -hex 64)
HUB_PROTOCOL_API_KEY=$(openssl rand -hex 64)
# ... etc
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker logs hestia-brain-synap

# Check status
docker ps -a | grep hestia

# Check network
docker network inspect hestia-network

# Restart service
docker restart hestia-brain-synap
```

### Can't Connect to Service

```bash
# Test from within network
docker run --rm --network hestia-network curlimages/curl \
  http://hestia-brain-synap:4000/health

# Check port binding
netstat -tlnp | grep 4000
```

### Data Loss

```bash
# Check volumes
docker volume ls | grep hestia

# Backup volume
docker run --rm -v hestia-brain-postgres-data:/data \
  -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz -C /data .
```

---

## See Also

- [North Star Document](north-star.md) - Architecture vision
- [Architecture Decisions](architecture-decisions.md) - Design decisions
- [Operator Manual](../operator/README.md) - Day-to-day operations
