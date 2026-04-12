# Hestia CLI - Sovereign AI Infrastructure

**Monorepo for self-hosted AI infrastructure management**

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    USER INTERFACE LAYER                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │  USB Key    │  │  CLI Tool   │  │  Web API    │                 │
│  │ (OS Install)│  │ (Management)│  │  (Future)    │                 │
│  └──────┬──────┘  └──────┬──────┘  └─────────────┘                 │
└─────────┼────────────────┼────────────────────────────────────────┘
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    HESTIA CORE (packages/core)                      │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Commands   │  │   Services   │  │    State     │              │
│  │   (CLI)      │  │  (Business)  │  │   (Data)     │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SYSTEMS                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ Synap       │  │ OpenClaude  │  │  OpenClaw   │                 │
│  │ Backend     │  │   (AI)      │  │ (Assistant) │                 │
│  │(Knowledge)  │  │             │  │             │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📦 Package Structure

### Package Overview

| Package | Role | Technology | Location |
|---------|------|------------|----------|
| **`@hestia/core`** | CLI application & orchestration | TypeScript/Node.js | `packages/core/` |
| **`@hestia/install`** | System installation scripts | Bash/Shell | `packages/install/` |
| **`@hestia/usb`** | USB creation & bootstrapping | Bash/Ventoy | `packages/usb/` |

---

## 🎯 Separation of Concerns

### 1. USB Package (`@hestia/usb`)
**Purpose:** Bare-metal server provisioning via USB boot

**What it does:**
- Creates bootable USB keys
- Installs OS (Ubuntu Server)
- Installs base Hestia infrastructure
- Prepares system for remote management

**When to use:**
- Initial server setup
- Bare metal provisioning
- OS installation on new hardware
- Recovery/reinstallation

**Key features:**
- Ventoy bootloader (multi-boot support)
- Automated Ubuntu installation
- Safe vs Wipe installation modes
- Hardware detection
- Network configuration

**Technologies:**
- Bash scripting
- Ventoy (bootloader)
- cloud-init (Ubuntu autoinstall)
- ISO manipulation

**Output:**
- Bootable USB drive
- Installed Ubuntu Server
- Docker & Docker Compose
- Base Hestia services (Synap Backend, OpenClaw)

---

### 2. Core Package (`@hestia/core`)
**Purpose:** Management CLI & service orchestration

**What it does:**
- Manages Hestia services
- Configures AI providers
- Monitors hardware & health
- Handles state synchronization
- Provides operational commands

**When to use:**
- Day-to-day operations
- Service management
- Configuration changes
- Monitoring & debugging
- Remote management via API

**Key features:**
- 22 CLI commands
- Real-time health monitoring
- Hardware monitoring (CPU, memory, disk, network, GPU)
- OS management (packages, services, firewall)
- Agent communication (A2A bridge)
- Backup & recovery

**Technologies:**
- TypeScript/Node.js (ES modules)
- Commander.js (CLI framework)
- Zod (schema validation)
- TanStack Query (API client)
- Chalk/Ora/Listr2 (CLI UI)
- EventEmitter3 (messaging)

**Integration points:**
- Synap Backend API (REST + tRPC)
- OpenClaude (via npm package)
- OpenClaw (via API or file)
- System services (systemd, Docker)

---

### 3. Install Package (`@hestia/install`)
**Purpose:** System-level installation scripts

**What it does:**
- Installs system dependencies
- Configures OS-level settings
- Sets up Docker environment
- Hardens security (SSH, firewall)
- Prepares directory structure

**When to use:**
- Called by USB installer during OS setup
- Manual installation on existing systems
- Recovery scenarios

**Key features:**
- 3-phase installation (Foundation → Core → Builder)
- Idempotent (safe to re-run)
- Resume capability
- Phase-by-phase execution
- Automatic hardware detection

**Technologies:**
- Bash scripting
- systemd (services)
- UFW (firewall)
- Docker & Docker Compose
- cloud-init

---

## 🔌 Integration Points & APIs

### 1. Synap Backend API
**Location:** `packages/api/src/routers/hub-protocol/`

**Endpoints:**
- `POST /api/hub/hearth/register` - Register hearth node
- `POST /api/hub/hearth/heartbeat` - Health check-in
- `GET /api/hub/hearth/status/:id` - Get node status
- `POST /api/hub/intelligence/query` - AI query (agnostic)

**Authentication:** Bearer token (API key)
**Protocol:** REST + tRPC
**Data format:** JSON

### 2. OpenClaude Integration
**Package:** `@gitlawb/openclaude` (npm)

**Interface:**
- gRPC server (port 50051)
- CLI commands
- Environment variables

**Configuration:**
```bash
# Via environment
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o

# Via Hestia config
hestia ai:configure
```

### 3. OpenClaw Integration
**Method:** API calls or file-based

**Configuration file:** `~/.openclaw/config.yaml`
**Skills directory:** `~/.openclaw/skills/`
**Comms:** Telegram/WhatsApp/Discord bots

### 4. A2A Bridge (Agent-to-Agent)
**Location:** `packages/core/src/lib/a2a-bridge.ts`

**Protocol:** Internal message bus (EventEmitter3)
**Shared memory:** In-memory + persisted to Synap
**Message format:** JSON with metadata

---

## 🔑 Authentication & API Keys

### Authentication Flow

```
User → Hestia CLI → Synap Backend API
         │
         ├─ API Key (Bearer token)
         ├─ JWT Token (for user auth)
         └─ Service Account (for agents)
```

### Storage
- **API Keys:** `~/.hestia/credentials.yaml` (mode 0600)
- **JWT Tokens:** In-memory or secure storage
- **Service Accounts:** Synap Backend entities

### Remote Access
```bash
# Configure remote server
hestia config set synapBackendUrl https://my-server:4000
hestia config set apiKey sk-... --secret

# Now all commands target remote server
hestia status          # Shows remote server status
hestia health          # Checks remote server health
hestia ai              # Connects to remote AI
```

---

## 🌐 Use Case: Distributed Architecture

### Your Scenario

**Goal:** 
- USB key sets up server with OS + AI (self-contained)
- CLI tool manages the server from your laptop
- API key connects laptop to remote server
- AI runs on server, accessed via API

**Implementation:**

```
┌─────────────────┐         API Key          ┌─────────────────┐
│   Your Laptop   │  ──────────────────────>  │  Hestia Server  │
│                 │                           │  (Data Center)  │
│  hestia cli     │      REST API calls       │                 │
│  ├─ config      │      hestia status        │  ├─ Synap       │
│  ├─ health      │      hestia health        │  ├─ OpenClaude  │
│  ├─ ai (remote) │      hestia ai            │  ├─ OpenClaw    │
│  └─ monitoring  │                           │  └─ AI Models   │
└─────────────────┘                           └─────────────────┘
         │                                           ▲
         │         USB Key (Initial Setup)            │
         └───────────────────────────────────────────┘
                  ┌─────────────┐
                  │ hestia usb  │
                  │  create     │
                  └─────────────┘
```

### Step-by-Step

**Step 1: Generate USB Key (on your laptop)**
```bash
# Create USB for server
hestia usb:create \
  --device /dev/sdb \
  --mode safe \
  --hearth-name "my-ai-server" \
  --ai-provider ollama \
  --ai-model llama3.2
```

**Step 2: Install on Server**
- Insert USB into server
- Boot from USB
- Automated installation completes
- Server reboots with Hestia ready

**Step 3: Get API Key (on server)**
```bash
# On the server, get API key
hestia config get apiKey --show
# or
cat ~/.hestia/credentials.yaml
```

**Step 4: Configure Remote Access (on your laptop)**
```bash
# Add server to laptop CLI
hestia config set synapBackendUrl https://server-ip:4000
hestia config set apiKey <server-api-key> --secret

# Test connection
hestia status
hestia health
```

**Step 5: Manage Remotely (from laptop)**
```bash
# All commands now target remote server
hestia status              # Remote server status
hestia health              # Remote health check
hestia ai "hello"          # Remote AI query
hestia hardware            # Remote hardware monitoring
hestia os:packages update  # Remote OS updates
```

---

## 📋 Commands by Package

### @hestia/usb Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `hestia usb` | Interactive USB wizard | Creating USB for new server |
| `hestia usb:list` | List USB devices | Finding device path |
| `hestia usb:create` | Create bootable USB | Direct USB creation |
| `hestia usb:verify` | Verify USB bootability | Before physical install |
| `hestia usb:benchmark` | Test USB speed | Checking USB quality |

### @hestia/install (Used Indirectly)

Called automatically during:
- USB installation
- `hestia install [phase]`
- `hestia init` (first-fire wizard)

### @hestia/core Commands

**Lifecycle:**
- `hestia init` - Initialize configuration
- `hestia status` - Check all services
- `hestia ignite` - Start all services
- `hestia extinguish` - Stop all services

**Package Management:**
- `hestia add <pkg>` - Install package
- `hestia remove <pkg>` - Remove package
- `hestia package list` - List packages

**AI & Agents:**
- `hestia ai` - OpenClaude coding assistant
- `hestia assistant` - OpenClaw personal assistant
- `hestia agents` - Agent communication

**Operations:**
- `hestia validate` - Production validation
- `hestia health` - Health monitoring
- `hestia test` - Run tests
- `hestia recovery` - Backup & repair

**Hardware & OS:**
- `hestia hardware` - Hardware monitoring
- `hestia os` - OS management
- `hestia provision` - Server provisioning

---

## 🔧 Technologies Stack

### Runtime
- **Node.js:** >= 18 (ES modules)
- **Bash:** For install scripts
- **Docker:** Container runtime
- **Docker Compose:** Multi-container orchestration

### CLI Framework
- **Commander.js:** Command parsing
- **Chalk:** Terminal colors
- **Ora:** Spinners/loading
- **Listr2:** Task lists
- **Inquirer:** Interactive prompts

### Data & API
- **Zod:** Schema validation
- **TanStack Query:** API client
- **js-yaml:** YAML parsing
- **EventEmitter3:** Event bus

### System Integration
- **systemd:** Service management
- **UFW:** Firewall
- **Ventoy:** USB bootloader
- **cloud-init:** OS autoinstall

---

## 🚀 Quick Start

### 1. Install CLI (on your laptop)
```bash
npm install -g @hestia/cli
# or locally
cd hestia-cli/packages/core
pnpm install && pnpm build
```

### 2. Create USB (on your laptop)
```bash
hestia usb
# or
./dist/hestia.js usb
```

### 3. Install on Server
- Insert USB into server
- Boot from USB
- Automated installation

### 4. Configure Remote Access
```bash
# On server, get API key
hestia config get apiKey

# On laptop, add server
hestia config set synapBackendUrl https://server-ip:4000
hestia config set apiKey <key>

# Test
hestia status
```

### 5. Manage Remotely
```bash
hestia health
hestia ai "your question"
hestia hardware
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| `MASTER-INDEX.md` | Navigation hub |
| `COMPLETE-SYSTEM.md` | Full system overview |
| `PRODUCTION-READY.md` | Deployment guide |
| `TESTING-GUIDE.md` | Testing procedures |
| `ARCHITECTURE.md` | This document |
| `packages/core/README.md` | CLI package docs |
| `packages/install/README.md` | Installer docs |
| `packages/usb/README.md` | USB tools docs |

---

## 🔗 Repository Links

- **Main:** `github.com/synap/hestia-cli`
- **Issues:** `github.com/synap/hestia-cli/issues`
- **Docs:** `docs.hestia.dev`

---

**Status:** Production Ready ✅  
**Version:** 2.0.0  
**License:** MIT
