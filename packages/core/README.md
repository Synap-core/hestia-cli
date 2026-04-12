# @hestia/core - CLI Application

**Sovereign AI Infrastructure Management CLI**

---

## 📋 Package Role

**Purpose:** Management CLI and service orchestration for Hestia nodes

**Scope:**
- Day-to-day operations
- Service management (start, stop, monitor)
- Configuration management
- Hardware monitoring
- OS management
- Agent communication
- Remote node management via API

**When to Use:**
- Managing existing Hestia installations
- Remote server administration
- Health monitoring
- Configuration changes
- AI interactions (OpenClaude, OpenClaw)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           CLI Interface                 │
│  (Commander.js + Inquirer)             │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│           Command Layer               │
│  (22 command modules)                 │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│          Service Layer                  │
│  (18 library services)                │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│         Integration Layer               │
│  (Synap, OpenClaude, OpenClaw, System) │
└─────────────────────────────────────────┘
```

---

## 🛠️ Technologies

### Core Stack
| Technology | Purpose | Version |
|------------|---------|---------|
| **Node.js** | Runtime | >= 18 (ES modules) |
| **TypeScript** | Language | ^5.4.5 |
| **Commander.js** | CLI framework | ^12.0.0 |
| **Zod** | Schema validation | ^3.23.8 |

### UI/UX
| Technology | Purpose |
|------------|---------|
| **Chalk** | Terminal colors |
| **Ora** | Loading spinners |
| **Listr2** | Task lists |
| **Inquirer** | Interactive prompts |

### Data & API
| Technology | Purpose |
|------------|---------|
| **js-yaml** | YAML config parsing |
| **TanStack Query** | API client (via @synap/client) |
| **EventEmitter3** | Event bus / messaging |

### External Integrations
| Technology | Purpose |
|------------|---------|
| **@gitlawb/openclaude** | AI coding agent |
| **OpenClaw** | Personal assistant (via API/file) |
| **Synap Backend** | Knowledge graph (REST + tRPC) |

---

## 📁 File Structure

```
packages/core/
├── src/
│   ├── commands/              # 22 CLI commands
│   │   ├── init.ts            # Initialize Hestia
│   │   ├── status.ts          # Check system status
│   │   ├── ignite.ts          # Start services
│   │   ├── extinguish.ts      # Stop services
│   │   ├── add.ts             # Add packages
│   │   ├── remove.ts          # Remove packages
│   │   ├── config.ts          # Configuration management
│   │   ├── package.ts         # Package operations
│   │   ├── install.ts         # Installation phases
│   │   ├── ai.ts              # OpenClaude integration
│   │   ├── assistant.ts       # OpenClaw integration
│   │   ├── agents.ts          # A2A bridge commands
│   │   ├── validate.ts        # Production validation
│   │   ├── health.ts          # Health monitoring
│   │   ├── test.ts            # Test suite runner
│   │   ├── recovery.ts        # Recovery operations
│   │   ├── hardware.ts        # Hardware monitoring
│   │   ├── os.ts              # OS management
│   │   ├── usb.ts             # USB generation
│   │   ├── provision.ts       # Server provisioning
│   │   └── index.ts           # Command exports
│   │
│   ├── lib/                   # 18 service libraries
│   │   ├── config.ts          # YAML configuration
│   │   ├── api-client.ts      # Synap Backend HTTP client
│   │   ├── package-service.ts # Package lifecycle
│   │   ├── logger.ts          # Styled output
│   │   ├── spinner.ts         # Progress indicators
│   │   ├── task-list.ts       # Multi-step tasks
│   │   ├── state-manager.ts   # Unified state (2,300 lines)
│   │   ├── a2a-bridge.ts      # Agent communication (1,700 lines)
│   │   ├── openclaude-service.ts # OpenClaude wrapper (1,800 lines)
│   │   ├── openclaw-service.ts # OpenClaw wrapper (1,300 lines)
│   │   ├── validator.ts       # Production validator (2,300 lines)
│   │   ├── health-check.ts    # Health monitoring (1,700 lines)
│   │   ├── test-suite.ts      # Test framework (2,700 lines)
│   │   ├── recovery.ts        # Recovery system (2,200 lines)
│   │   ├── hardware-monitor.ts # Hardware monitoring (1,800 lines)
│   │   ├── os-manager.ts      # OS management (2,800 lines)
│   │   ├── usb-generator.ts   # USB generation (2,800 lines)
│   │   ├── server-provisioner.ts # Server provisioning (700 lines)
│   │   └── index.ts           # Library exports
│   │
│   ├── types.ts               # TypeScript definitions
│   ├── hestia.ts              # CLI entry point
│   └── index.ts               # Package exports
│
├── package.json               # Dependencies & scripts
├── tsconfig.json              # TypeScript config
└── README.md                  # This file
```

---

## 📊 Commands (22 Total)

### Category: Lifecycle (4)

| Command | File | Purpose | Usage Frequency |
|---------|------|---------|-----------------|
| `hestia init` | `init.ts` | Initialize Hestia node | One-time setup |
| `hestia status` | `status.ts` | Check all services | Daily |
| `hestia ignite` | `ignite.ts` | Start all services | Occasional |
| `hestia extinguish` | `extinguish.ts` | Stop all services | Occasional |

### Category: Package Management (2)

| Command | File | Purpose |
|---------|------|---------|
| `hestia add <pkg>` | `add.ts` | Install package |
| `hestia remove <pkg>` | `remove.ts` | Remove package |
| `hestia package <cmd>` | `package.ts` | Package operations (list, info, logs, update) |

### Category: Configuration (2)

| Command | File | Purpose |
|---------|------|---------|
| `hestia config <cmd>` | `config.ts` | View/edit config (get, set, wizard, sync) |
| `hestia install [phase]` | `install.ts` | Run installation phases |

### Category: AI & Agents (3)

| Command | File | Purpose | External Integration |
|---------|------|---------|---------------------|
| `hestia ai <cmd>` | `ai.ts` | OpenClaude coding assistant | @gitlawb/openclaude |
| `hestia assistant <cmd>` | `assistant.ts` | OpenClaw personal assistant | OpenClaw API/file |
| `hestia agents <cmd>` | `agents.ts` | Agent-to-agent bridge | A2A Bridge (internal) |

**Subcommands:**
- `ai:status, ai:configure, ai:mcp, ai:setup, ai:stop`
- `assistant:status, assistant:skill, assistant:comm, assistant:send, assistant:activity, assistant:stop`
- `agents:list, agents:send, agents:broadcast, agents:memory, agents:route, agents:status`

### Category: Operations (4)

| Command | File | Purpose | Key Features |
|---------|------|---------|--------------|
| `hestia validate <cmd>` | `validate.ts` | Production validation | 27 checks, auto-fix, reports |
| `hestia health <cmd>` | `health.ts` | Health monitoring | Real-time, continuous watch |
| `hestia test <cmd>` | `test.ts` | Test suite | 20+ tests, unit/integration/e2e |
| `hestia recovery <cmd>` | `recovery.ts` | Backup & repair | Backup, restore, repair, safe-mode |

**Subcommands:**
- `validate:system, validate:dependencies, validate:config, validate:services, validate:integration, validate:production`
- `health:watch, health:services, health:resources, health:network, health:report`
- `test:unit, test:integration, test:e2e, test:smoke, test:watch, test:ci`
- `recovery:backup, recovery:restore, recovery:repair, recovery:diagnose, recovery:safe-mode, recovery:auto`

### Category: Hardware & OS (4)

| Command | File | Purpose | Key Features |
|---------|------|---------|--------------|
| `hestia hardware <cmd>` | `hardware.ts` | Hardware monitoring | CPU, memory, disk, network, GPU |
| `hestia os <cmd>` | `os.ts` | OS management | Packages, services, users, firewall |
| `hestia usb <cmd>` | `usb.ts` | USB generation | Ventoy, ISO download, bootable USB |
| `hestia provision <cmd>` | `provision.ts` | Server provisioning | Bare metal, profiles, benchmarks |

**Subcommands:**
- `hardware:watch, hardware:cpu, hardware:memory, hardware:disk, hardware:network, hardware:gpu, hardware:thermal, hardware:report, hardware:alerts`
- `os:info, os:packages, os:services, os:users, os:network, os:firewall, os:disk, os:sysctl, os:report, os:backup, os:restore`
- `usb:list, usb:create, usb:download, usb:ventoy, usb:verify, usb:config, usb:benchmark`
- `provision:hardware, provision:diagnose, provision:profile, provision:plan, provision:usb, provision:benchmark, provision:cluster, provision:report`

---

## 🔧 Services (18 Total)

### Core Services (6)

| Service | File | Purpose | Dependencies |
|---------|------|---------|--------------|
| **Config** | `config.ts` | YAML config management | js-yaml, Zod |
| **API Client** | `api-client.ts` | Synap Backend HTTP client | Node fetch |
| **Package Service** | `package-service.ts` | Package lifecycle | Docker, npm, git |
| **Logger** | `logger.ts` | Styled terminal output | Chalk |
| **Spinner** | `spinner.ts` | Progress indicators | Ora |
| **Task List** | `task-list.ts` | Multi-step tasks | Listr2 |

### Integration Services (4)

| Service | File | Purpose | External Dependencies |
|---------|------|---------|---------------------|
| **State Manager** | `state-manager.ts` | 3-layer state sync | Synap Backend, file system |
| **A2A Bridge** | `a2a-bridge.ts` | Agent communication | EventEmitter3 |
| **OpenClaude Service** | `openclaude-service.ts` | AI coding wrapper | @gitlawb/openclaude |
| **OpenClaw Service** | `openclaw-service.ts` | Assistant wrapper | OpenClaw API/file |

### Operations Services (4)

| Service | File | Purpose | Key Features |
|---------|------|---------|--------------|
| **Validator** | `validator.ts` | Production validation | 27 checks, auto-fix |
| **Health Check** | `health-check.ts` | Health monitoring | Real-time, thresholds |
| **Test Suite** | `test-suite.ts` | Automated testing | 20+ tests, CI mode |
| **Recovery** | `recovery.ts` | Backup & repair | Idempotent, safe mode |

### Infrastructure Services (4)

| Service | File | Purpose | System Integration |
|---------|------|---------|---------------------|
| **Hardware Monitor** | `hardware-monitor.ts` | Hardware metrics | /proc, /sys, sensors, smartctl |
| **OS Manager** | `os-manager.ts` | OS management | apt, systemd, ufw |
| **USB Generator** | `usb-generator.ts` | USB creation | Ventoy, dd, ISO |
| **Server Provisioner** | `server-provisioner.ts` | Bare metal | Hardware detection, IPMI |

---

## 🔌 Integration Points

### 1. Synap Backend (Knowledge Graph)

**Protocol:** REST API + tRPC (via @synap/client)
**Base URL:** Configurable (default: http://localhost:4000)
**Authentication:** Bearer token (API key)

**Key Endpoints:**
- `GET /api/hub/hearth/status/:id` - Node status
- `POST /api/hub/hearth/heartbeat` - Health check
- `POST /api/hub/intelligence/query` - AI queries

**Usage:**
```typescript
import { ApiClient } from '@hestia/core';
const api = new ApiClient({ baseUrl, apiKey });
const status = await api.getHearthStatus(hearthId);
```

### 2. OpenClaude (AI Coding Agent)

**Package:** `@gitlawb/openclaude` (npm)
**Interface:** gRPC server + CLI
**Port:** 50051 (gRPC)

**Configuration:**
- Environment variables (OPENAI_API_KEY, etc.)
- Profile file: `~/.openclaude-profile.json`

**Usage:**
```typescript
import { openclaudeService } from '@hestia/core';
await openclaudeService.start();
await openclaudeService.executeCommand("generate code");
```

### 3. OpenClaw (Personal Assistant)

**Method:** File-based config + API (if available)
**Config:** `~/.openclaw/config.yaml`
**Skills:** `~/.openclaw/skills/`

**Usage:**
```typescript
import { openclawService } from '@hestia/core';
await openclawService.start({ assistantName: 'Jarvis' });
await openclawService.sendMessage("What's on my calendar?");
```

### 4. System Integration

**Services:**
- Docker (via CLI)
- systemd (service management)
- UFW (firewall)
- Package managers (apt, dnf, brew)

**Usage:**
```typescript
import { osManager } from '@hestia/core';
await osManager.startService('synap-backend');
await osManager.allowPort(3000);
```

---

## 📦 Data Flow

### State Synchronization

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Hestia CLI  │◄───►│ State Manager │◄───►│ Synap Backend│
│  (Local)     │     │ (Sync Engine) │     │  (Remote)    │
└──────┬───────┘     └──────┬───────┘     └──────────────┘
       │                    │
       │         ┌───────────▼───────────┐
       └────────►│   Local Config Files  │
                 │ ~/.hestia/config.yaml │
                 │ ~/.openclaude-profile │
                 │ ~/.openclaw/config    │
                 └───────────────────────┘
```

### Remote Management

```
Laptop ──API Key──► Hestia Server
   │                    │
   │ hestia status      │ Synap Backend
   │ hestia health      │ OpenClaude (AI)
   │ hestia ai          │ OpenClaw (Assistant)
   │ hestia hardware    │
```

---

## 🚀 Development

### Install Dependencies
```bash
cd packages/core
pnpm install
```

### Build
```bash
pnpm build
```

### Run in Development
```bash
# Run specific command
./dist/hestia.js status

# Watch mode
pnpm dev
```

### Test
```bash
# Run tests
pnpm test

# Type check
pnpm typecheck
```

---

## 📋 Usage Examples

### Initialize Hestia
```bash
hestia init
# Interactive wizard for first-time setup
```

### Check Status
```bash
hestia status
# Shows all services, packages, health
```

### AI Coding
```bash
hestia ai
# Starts OpenClaude interactive session
```

### Personal Assistant
```bash
hestia assistant send "What's my schedule today?"
```

### Hardware Monitoring
```bash
hestia hardware
hestia hardware:watch --interval 5
```

### OS Management
```bash
hestia os:packages update
hestia os:services restart synap-backend
```

### Remote Management
```bash
# Configure remote server
hestia config set synapBackendUrl https://my-server:4000
hestia config set apiKey <token> --secret

# Now all commands target remote server
hestia status
hestia health
```

---

## 🔗 Related Packages

- **@hestia/install** - System installation scripts
- **@hestia/usb** - USB creation tools

---

## 📚 More Documentation

- [Architecture Overview](../../ARCHITECTURE.md)
- [Complete System Guide](../../COMPLETE-SYSTEM.md)
- [Production Ready](../../PRODUCTION-READY.md)
- [Testing Guide](../../TESTING-GUIDE.md)

---

**Status:** Production Ready ✅  
**Version:** 2.0.0  
**License:** MIT
