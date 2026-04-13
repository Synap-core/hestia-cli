# Eve - Entity Creation System

> **Create your sovereign digital entity.**
> 
> Eve transforms a bare server into a living digital being with intelligence, memory, and capabilities.

## What is Eve?

Eve is an **Entity Creation System**. It takes a bare server (physical or virtual) and transforms it into a sovereign digital entity with:

- 🧠 **Brain** - Core intelligence and memory
- 🦾 **Arms** - Action and execution capabilities  
- 🏗️ **Builder** - Creation and deployment tools
- 👁️ **Eyes** - Perception and knowledge intake
- 🦿 **Legs** - Presence and exposure to the world

Unlike traditional server setups, Eve creates a **cohesive entity** where all components work together as a unified system.

## Quick Start

### Path 1: Fresh Server (Physical or VM)

```bash
# 1. Create bootable USB (for physical servers)
eve birth create-usb --device /dev/sdb

# Boot from USB, then:
# 2. Initialize the Brain
eve brain init --with-ai

# 3. Add Arms (AI assistant)
eve arms install

# 4. Setup Builder (creation tools)
eve builder init my-project

# 5. Check entity status
eve status
```

### Path 2: Existing Server

```bash
# Run on any Ubuntu/Debian server
curl -fsSL https://eve.sh/install.sh | bash

# Initialize
eve brain init --with-ai
eve arms install
eve builder init my-project
eve legs setup
```

### Path 3: Proxmox VM

```bash
# In Proxmox:
# 1. Download Ubuntu 24.04 ISO
# 2. Create VM (4+ cores, 8+ GB RAM, 50+ GB disk)
# 3. Install Ubuntu
# 4. SSH into VM and run:

curl -fsSL https://eve.sh/install.sh | bash
eve brain init --with-ai
eve status
```

## Entity Anatomy

```
Your Digital Entity
├── 🧠 BRAIN (Core Intelligence)
│   ├── Synap Backend - API, identity, knowledge graph
│   ├── Ollama - Local AI model (Llama 3.1, etc.)
│   ├── PostgreSQL - Long-term memory
│   └── Redis - Working memory
│
├── 🦾 ARMS (Action)
│   └── OpenClaw - AI coding assistant with MCP servers
│       └── Connects to Brain's Ollama for intelligence
│
├── 🏗️ BUILDER (Creation Suite)
│   ├── OpenCode - Generate websites and docs
│   ├── OpenClaude - AI-assisted coding (uses Brain AI)
│   └── Dokploy - Deploy to production
│
├── 👁️ EYES (Perception)
│   └── RSSHub - Consume RSS feeds, APIs
│       └── Feeds knowledge into Brain
│
└── 🦿 LEGS (Exposure)
    └── Traefik - Reverse proxy, SSL, domain routing
        └── Exposes your entity to the internet
```

## Core Commands

```bash
# Entity lifecycle
eve birth create-usb     # Create bootable USB
eve brain init           # Initialize core
eve brain init --with-ai # Include local AI
eve status               # Check entity health
eve doctor               # Diagnose issues
eve grow                 # Expand capabilities

# Organs
eve arms install         # Install AI assistant
eve builder init <name>  # Create project
eve builder deploy       # Deploy to production
eve eyes install         # Add RSS aggregation
eve legs setup           # Configure domain/SSL
```

## Why Eve?

### vs Traditional Server Setup

| Traditional | Eve |
|-------------|-----|
| Install apps individually | Unified entity with connected organs |
| Manual configuration | Automated, opinionated setup |
| Apps don't talk to each other | All organs connect to Brain |
| Cloud dependencies | Fully self-hosted, private |
| Complex maintenance | Entity state tracking, self-healing |

### vs Cloud Platforms

| Cloud (Vercel, Railway, etc.) | Eve |
|-------------------------------|-----|
| Vendor lock-in | You own everything |
| Monthly costs | One-time server cost |
| Data on their servers | Data stays on your server |
| Limited customization | Full control, open source |
| Internet required | Works offline (local AI) |

## Technology Stack

Eve is built on proven open-source technologies:

- **Container Runtime**: Docker + Docker Compose
- **AI Engine**: Ollama (local LLM inference)
- **AI Assistants**: OpenClaw, OpenClaude
- **Database**: PostgreSQL (data), Redis (cache)
- **Reverse Proxy**: Traefik (automatic SSL)
- **Deployment**: Dokploy (self-hosted PaaS)
- **RSS Aggregation**: RSSHub

See [docs/technology-choices.md](docs/technology-choices.md) for detailed comparison of each technology choice.

## Documentation

- [Getting Started](docs/getting-started.md) - First steps
- [Architecture](docs/architecture.md) - Entity anatomy
- [Technology Choices](docs/technology-choices.md) - Why we chose each tool
- [Deployment Guide](docs/deployment.md) - Deploy your entity
- [Configuration](docs/configuration.md) - Customize your entity

## Requirements

### Minimum (Basic Entity)
- 2 CPU cores
- 4 GB RAM
- 20 GB storage
- Ubuntu 22.04+ / Debian 12+

### Recommended (Full AI Entity)
- 4+ CPU cores
- 8+ GB RAM (16+ for larger AI models)
- 50+ GB storage (SSD recommended)
- Ubuntu 24.04 LTS

### For Local AI
- GPU optional (accelerates AI inference)
- Without GPU: CPU inference works fine

## License

MIT - See [LICENSE](LICENSE)

---

**Create your digital self.**

