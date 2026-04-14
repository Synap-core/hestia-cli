# Technology Choices

This document explains why we chose each technology for Eve and the trade-offs we considered.

## Overview

Eve is built on a stack of proven, open-source technologies. Each choice prioritizes:

1. **Sovereignty** - Self-hosted, no vendor lock-in
2. **Simplicity** - Easy to understand and maintain
3. **Integration** - Works well with other components
4. **Performance** - Efficient resource usage

---

## Container Runtime: Docker + Docker Compose

### Why Docker?

Docker containers provide isolation, portability, and reproducibility. Each organ runs in its own container with defined dependencies.

### Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Docker** | Mature ecosystem, easy to use, great docs | Requires daemon, some overhead | ✅ **Chosen** - Best balance |
| **Podman** | Daemonless, rootless, Red Hat backed | Smaller ecosystem, less tooling | Good alternative, not as mature |
| **LXC/LXD** | Native Linux, lightweight | Less portable, harder to use | Too low-level |
| **Kubernetes** | Industry standard, scalable | Overkill for single server, complex | Too complex for our use case |

### Why Docker Compose?

Docker Compose allows us to define the entire entity in a single `docker-compose.yml` file. It orchestrates all organs with one command.

```yaml
# Example: Starting Eve
version: '3.8'
services:
  brain:
    image: synap/backend:latest
  ollama:
    image: ollama/ollama:latest
  arms:
    image: openclaw:latest
    depends_on:
      - ollama
```

**Run:** `docker compose up -d`

---

## AI Engine: Ollama

### Why Ollama?

Ollama provides local LLM inference with a simple API. It downloads and runs models like Llama, Mistral, and CodeLlama locally.

### Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Ollama** | Easy setup, simple API, model management | Limited to supported models | ✅ **Chosen** - Best developer experience |
| **LocalAI** | Supports more models, OpenAI-compatible API | More complex setup | Good alternative |
| **llama.cpp** | Maximum performance, minimal dependencies | Command-line only, harder to use | Too low-level |
| **Text Generation WebUI** | Great UI, many features | Heavier resource usage | Good for power users, not for our focus |
| **Cloud APIs (OpenAI, etc.)** | Best models, no hardware needed | Requires internet, data leaves your server, costs | ❌ Rejected - violates sovereignty |

### Ollama Strengths

1. **One-command model pull:** `ollama pull llama3.1`
2. **Simple API:** `curl http://localhost:11434/api/generate`
3. **Model caching:** Downloads once, runs offline
4. **CPU/GPU support:** Works on CPU, accelerates with GPU

### Trade-offs

- **Model size:** Large models (70B+) require significant RAM
- **Startup time:** First run downloads models (can be GBs)
- **Limited models:** Only supports Ollama-compatible models

---

## AI Assistants: OpenClaw + OpenClaude

### Why Two Assistants?

Different assistants excel at different tasks. We include both for flexibility.

### OpenClaw (Arms)

**Purpose:** Action-oriented AI assistant with MCP (Model Context Protocol)

**Strengths:**
- MCP servers for tool use (file system, databases, APIs)
- Shell command execution
- Task automation
- Code generation

**Best for:** Building, scripting, automation

### OpenClaude (Builder)

**Purpose:** AI-assisted development and content creation

**Strengths:**
- Code understanding and generation
- Documentation writing
- Content creation
- Project scaffolding

**Best for:** Development, writing, creating

### Alternatives Considered

| Option | Pros | Cons | Use Case |
|--------|------|------|----------|
| **OpenClaw** | MCP support, action-oriented | Newer project | Automation, tasks |
| **OpenClaude** | Great at coding, mature | No MCP | Development, writing |
| **Continue.dev** | IDE integration | Requires IDE | Development |
| **Aider** | Great for coding | CLI only | Development |

**Decision:** Include both. User chooses based on task.

---

## Database: PostgreSQL + Redis

### PostgreSQL (Long-term Memory)

**Why PostgreSQL?**

PostgreSQL is the gold standard for relational databases. It's reliable, feature-rich, and handles complex queries well.

**Use in Eve:**
- Synap Backend data
- User data
- Knowledge graph
- RSS feed content

**Alternatives:**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **PostgreSQL** | Mature, reliable, feature-rich | Heavier than SQLite | ✅ **Chosen** - Production proven |
| **SQLite** | Zero config, lightweight | No concurrent writes, limited scale | Too limiting |
| **MySQL** | Widely used, good performance | Oracle ownership concerns | Good, but PostgreSQL preferred |
| **CockroachDB** | Distributed, cloud-native | Complex, overkill | Too complex |

### Redis (Working Memory)

**Why Redis?**

Redis provides fast, in-memory data storage. Perfect for caching, sessions, and real-time data.

**Use in Eve:**
- Session cache
- Real-time data
- Job queues
- Rate limiting

**Alternatives:**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Redis** | Fast, mature, many use cases | Memory-only (data loss risk) | ✅ **Chosen** - Industry standard |
| **KeyDB** | Redis-compatible, multi-threaded | Smaller community | Good alternative |
| **Memcached** | Simple, fast | No persistence, fewer features | Too limited |
| **Valkey** | Redis fork (AWS) | Newer, smaller ecosystem | Good, but Redis proven |

---

## Reverse Proxy: Traefik

### Why Traefik?

Traefik automatically discovers and routes traffic to containers. It handles SSL certificates (Let's Encrypt) automatically.

**Strengths:**
1. **Docker integration:** Auto-discovers containers
2. **Automatic SSL:** Let's Encrypt integration
3. **Modern:** Built for microservices/containers
4. **Dashboard:** Visual traffic overview

### Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Traefik** | Auto-discovery, modern, easy SSL | Newer, less mature than Nginx | ✅ **Chosen** - Built for containers |
| **Nginx** | Battle-tested, maximum performance | Manual configuration | Good alternative |
| **Caddy** | Automatic HTTPS, simple config | Smaller ecosystem | Good, but Traefik has better Docker support |
| **Apache** | Ubiquitous, .htaccess | Heavy, complex config | Too complex |

### Configuration Example

```yaml
# docker-compose.yml labels for Traefik
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.brain.rule=Host(`api.mydomain.com`)"
  - "traefik.http.routers.brain.tls.certresolver=letsencrypt"
```

**No manual config needed!** Traefik reads Docker labels.

---

## Deployment: Dokploy

### Why Dokploy?

Dokploy is a self-hosted PaaS (Platform as a Service). It provides Heroku-like deployment on your own server.

**Strengths:**
1. **Self-hosted:** You own the platform
2. **Git-based deployment:** Push to deploy
3. **Database management:** Built-in PostgreSQL, MySQL, Redis, MongoDB
4. **SSL automatically:** Let's Encrypt integration
5. **Docker-based:** Uses containers under the hood

### Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Dokploy** | Self-hosted PaaS, feature-rich, open source | Newer project | ✅ **Chosen** - Best self-hosted PaaS |
| **Coolify** | Self-hosted, popular | Less mature | Good alternative |
| **CapRover** | Easy setup, works well | Simpler feature set | Good for simple deployments |
| **Railway/Render (Cloud)** | Easy, managed | Cloud dependency, costs | ❌ Rejected - violates sovereignty |
| **Manual Docker** | Full control | Manual work, no UI | Too much manual work |
| **Kubernetes** | Industry standard | Complex, steep learning curve | Too complex |

### Dokploy Trade-offs

**Pros:**
- One-click app deployment
- Built-in database management
- Automatic SSL
- Multi-server support
- Open source (no lock-in)

**Cons:**
- Newer project (less mature than CapRover)
- Resource usage (runs as a service)
- Learning curve

---

## RSS Aggregation: RSSHub

### Why RSSHub?

RSSHub is an open-source RSS feed generator. It creates RSS feeds from websites that don't provide them.

**Strengths:**
1. **Wide coverage:** 1000+ sources (GitHub, Twitter, Reddit, etc.)
2. **Self-hosted:** Run on your own server
3. **Extensible:** Add custom routes
4. **Active community:** Constant updates

### Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **RSSHub** | Wide source coverage, self-hosted | Requires maintenance | ✅ **Chosen** - Best coverage |
| **FreshRSS** | Great reader UI, mature | No feed generation (reader only) | Good for reading, not for our use |
| **Miniflux** | Minimalist, fast | No feed generation | Good for reading |
| **Tiny Tiny RSS** | Self-hosted, plugins | Older codebase | Good, but RSSHub has better coverage |
| **Feedly (Cloud)** | Easy, works everywhere | Cloud dependency, costs | ❌ Rejected - violates sovereignty |

---

## Summary: Our Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| **Containers** | Docker + Compose | Standard, portable, easy |
| **AI Engine** | Ollama | Simple local LLM inference |
| **AI Assistants** | OpenClaw + OpenClaude | Best tools for different tasks |
| **Database** | PostgreSQL | Reliable, feature-rich |
| **Cache** | Redis | Fast, proven |
| **Reverse Proxy** | Traefik | Auto-discovery, auto-SSL |
| **Deployment** | Dokploy | Self-hosted PaaS |
| **RSS** | RSSHub | Widest feed coverage |

## Philosophy

Our technology choices reflect these principles:

1. **Self-hosted first** - No cloud dependencies
2. **Open source** - No vendor lock-in
3. **Proven technologies** - Battle-tested tools
4. **Simple over complex** - Easy to understand and maintain
5. **Works offline** - Local AI, no internet required

---

## Future Considerations

Technologies we're watching for future integration:

- **vLLM** - Faster LLM inference (alternative to Ollama)
- **Valkey** - Redis alternative (AWS/MemoryDB fork)
- **Caddy** - Simpler than Traefik for some use cases
- **Podman** - Daemonless containers (may replace Docker)

---

## Service Naming Convention

Eve follows a consistent naming convention for all Docker resources:

### Container Naming
```
hestia-{organ}-{service}
```

Examples:
- `hestia-brain-synap`
- `hestia-brain-ollama`
- `hestia-arms-openclaw`
- `hestia-legs-traefik`

### Network Naming
```
hestia-network
```

All organs communicate through this shared Docker bridge network.

### Volume Naming
```
hestia-{organ}-{service}-data
```

Examples:
- `hestia-brain-postgres-data`
- `hestia-brain-ollama-data`
- `hestia-builder-dokploy-data`

This naming scheme ensures:
- **Clarity**: Easy to identify which organ a service belongs to
- **Consistency**: All resources follow the same pattern
- **Isolation**: Resources are namespaced per organ and service
- **Discoverability**: Services can reach each other by container name within `hestia-network`

