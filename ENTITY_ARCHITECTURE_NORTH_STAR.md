# Hestia Entity Architecture - North Star Vision

## Product Vision

Hestia is not just a CLI tool—it's an **Entity Creation System**. Each deployment creates a sovereign digital entity with distinct capabilities, organs, and lifecycle stages.

---

## The Entity Metaphor

### 🧠 Brain (Core Intelligence)
**Component:** Synap Backend (`synap-backend`)
- **Purpose:** Central nervous system, identity, memory
- **Capabilities:**
  - User authentication & sign-up
  - Entity state management
  - API gateway for all services
  - Data persistence (PostgreSQL)
  - Knowledge graph
- **External APIs:**
  - REST API for external integration
  - WebSocket for real-time updates
  - Webhook system for events
- **Relation:** The brain coordinates all other organs

### 🦾 Arms (Action & Execution)
**Component:** OpenClaude / OpenClaw (`openclaude-service`)
- **Purpose:** Execute tasks, code generation, automation
- **Capabilities:**
  - AI coding assistant
  - MCP (Model Context Protocol) servers
  - Task automation
  - Shell command execution
- **Alternatives:** Could be Claude, GPT-4, local Ollama
- **Relation:** Arms execute what the brain decides

### 🏗️ Builder (Creator & Generator)
**Component:** Website Generator + Doc-ployer
- **Purpose:** Create the entity's outer shell, presence
- **Capabilities:**
  - Static site generation
  - Documentation deployment
  - Template rendering
  - Asset pipeline
- **Relation:** Builder creates what the legs will show

### 🦿 Legs (Presence & Exposure)
**Component:** Traefik / Reverse Proxy + Tunnel
- **Purpose:** Make entity accessible to the world
- **Capabilities:**
  - Reverse proxy (Traefik/Nginx)
  - SSL/TLS termination
  - Domain management
  - Tunneling (Pangolin, Cloudflare)
- **Relation:** Legs carry the entity to the world

### 👁️ Eyes (Perception & Input)
**Component:** RSS Server + Connectors
- **Purpose:** Consume knowledge from outside world
- **Capabilities:**
  - RSS feed aggregation
  - External API connectors
  - Webhook receivers
  - Data ingestion pipelines
- **Relation:** Eyes feed information to the brain

### 🫀 Heart (Vital Systems)
**Component:** Core Infrastructure
- **Purpose:** Keep entity alive
- **Capabilities:**
  - Docker orchestration
  - Health monitoring
  - Auto-restart services
  - Resource management
- **Relation:** Heart pumps life to all organs

### 🫁 Lungs (Communication)
**Component:** Database Viewer + Redis
- **Purpose:** Data exchange, caching, breathing room
- **Capabilities:**
  - In-memory caching (Redis)
  - Database introspection (WhoDB)
  - Message queuing
  - Real-time pub/sub
- **Relation:** Lungs provide data oxygen

### 🧬 DNA (Identity & Configuration)
**Component:** Hestia Config + Credentials
- **Purpose:** Entity's unique identity and secrets
- **Capabilities:**
  - Configuration management
  - Secret storage
  - Environment variables
  - Feature flags
- **Relation:** DNA defines what the entity is

---

## Entity Lifecycle

### Phase 1: Conception (USB Creation)
```
User → hestia usb → Bootable USB
                 ↓
            [OS Image + Hestia Seed]
```

### Phase 2: Birth (OS Installation)
```
USB → Bare Metal Server → OS Installation
                          ↓
                    [Base System]
```

### Phase 3: Awakening (Hestia Install)
```
hestia install phase1 → Docker + Network
hestia install phase2 → Core Services
hestia install phase3 → AI + Optional Services
                        ↓
                   [Entity is Alive]
```

### Phase 4: Growth (Configuration)
```
hestia init → Brain Configuration
             ↓
        [Entity has Identity]
```

### Phase 5: Development (Arms & Builder)
```
hestia ai:setup → Arms (OpenClaude)
hestia deploy   → Builder creates website
                 ↓
            [Entity can Act & Create]
```

### Phase 6: Presence (Legs)
```
hestia tunnel → Legs connect to world
hestia ignite → Entity goes live
               ↓
          [Entity is Visible]
```

### Phase 7: Perception (Eyes)
```
hestia add rss-server → Eyes open
                       ↓
                  [Entity learns from world]
```

---

## Three Deployment Paths

### Path 1: Minimal Entity (AI-Only)
**Use Case:** Developer wants local AI coding assistant

```
USB Creation → OS Install → Phase 1 (Base)
                                ↓
                         Phase 2 (Core)
                                ↓
                         Phase 3 (AI Only)
                                ↓
                    [Brain + Arms + Heart]
                    [No Legs, No Eyes, No Builder]
```

**Components:**
- ✅ Brain (Synap Backend)
- ✅ Arms (OpenClaude)
- ✅ Heart (Docker)
- ❌ Legs (No reverse proxy)
- ❌ Builder (No website)
- ❌ Eyes (No RSS)

**Command:**
```bash
hestia install all --profile minimal
```

---

### Path 2: Full Entity (Complete)
**Use Case:** Full sovereign infrastructure with website, AI, everything

```
USB Creation → OS Install → Phase 1
                                ↓
                         Phase 2
                                ↓
                         Phase 3 (Full)
                                ↓
     [Brain + Arms + Heart + Legs + Builder + Eyes]
```

**Components:**
- ✅ Brain (Synap Backend)
- ✅ Arms (OpenClaude)
- ✅ Heart (Docker)
- ✅ Legs (Traefik + Tunnel)
- ✅ Builder (Website generator)
- ✅ Eyes (RSS Server)
- ✅ Lungs (Redis + WhoDB)

**Command:**
```bash
hestia install all --profile full
hestia deploy
```

---

### Path 3: Existing Server (No USB)
**Use Case:** User has existing server, wants to add Hestia

```
Existing Server → Skip OS Install
                      ↓
               hestia install phase1
                      ↓
               hestia install phase2
                      ↓
               hestia install phase3
                      ↓
              [Entity born on existing infrastructure]
```

**Difference:** Skip USB creation and OS installation phases

**Command:**
```bash
# On existing server
curl -fsSL https://hestia.sh/install.sh | bash
hestia install all
```

---

## Capability Packages

### Core Package (Required)
**Organs:** Brain, Heart, DNA
```yaml
packages:
  core:
    - synap-backend
    - postgres
    - redis
    - traefik
```

### Intelligence Package (Optional)
**Organs:** Arms
```yaml
packages:
  intelligence:
    - openclaude
    - ollama  # Alternative
    - ai-chat-ui  # Optional
```

### Presence Package (Optional)
**Organs:** Legs, Builder
```yaml
packages:
  presence:
    - website-generator
    - doc-ployer
    - pangolin-tunnel
    - cloudflare-tunnel
```

### Perception Package (Optional)
**Organs:** Eyes
```yaml
packages:
  perception:
    - rss-server
    - n8n-connectors
    - webhook-receiver
```

---

## Entity State Machine

```
┌─────────────┐
│   CREATED   │ ← USB Key Created
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   BIRTH     │ ← OS Installed
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  AWAKENING  │ ← Phase 1/2/3 Installing
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    ALIVE    │ ← Core services running
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ CONFIGURED  │ ← hestia init completed
└──────┬──────┘
       │
       ├──────────┬──────────┬──────────┐
       ▼          ▼          ▼          ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│  ARMS   │ │  LEGS   │ │ BUILDER │ │  EYES   │
│  Ready  │ │  Ready  │ │  Ready  │ │  Ready  │
└────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
     │           │           │           │
     └───────────┴───────────┴───────────┘
                 │
                 ▼
          ┌─────────────┐
          │    FULL     │
          │   ENTITY    │
          └─────────────┘
```

---

## Intelligent CLI Design

### Current State Tracking
The CLI should track entity state and offer intelligent suggestions:

```typescript
interface EntityState {
  phase: 'created' | 'birth' | 'awakening' | 'alive' | 'configured' | 'full'
  organs: {
    brain: 'missing' | 'installing' | 'ready' | 'error'
    arms: 'missing' | 'installing' | 'ready' | 'error'
    legs: 'missing' | 'installing' | 'ready' | 'error'
    builder: 'missing' | 'installing' | 'ready' | 'error'
    eyes: 'missing' | 'installing' | 'ready' | 'error'
  }
  capabilities: string[]
  nextSteps: string[]
}
```

### Intelligent Commands

#### `hestia status` (Enhanced)
```bash
$ hestia status

🧠 Entity Status: ALIVE (75% Complete)

Organs:
  🧠 Brain:    ✅ Ready (Synap Backend v2.1.0)
  🦾 Arms:     ✅ Ready (OpenClaude running)
  🦿 Legs:     ⚠️  Missing (No reverse proxy)
  🏗️ Builder:  ❌ Missing
  👁️ Eyes:     ❌ Missing

Capabilities:
  ✅ AI Coding Assistant
  ✅ Data Persistence
  ⚠️  Local Network Only (no tunnel)
  ❌ Public Website
  ❌ RSS Aggregation

Next Steps:
  1. hestia tunnel setup    → Enable public access
  2. hestia deploy          → Create website
  3. hestia add rss-server  → Add knowledge intake

Suggested Path: FULL ENTITY
Run: hestia install all --profile full
```

#### `hestia doctor` (New)
```bash
$ hestia doctor

🔍 Entity Health Check

Diagnosis:
  ✅ Brain: Healthy
  ⚠️  Arms: OpenClaude not configured
      Fix: hestia ai:configure
  ❌ Legs: Traefik not responding
      Fix: hestia ignite

Prescription:
  Run: hestia ai:setup && hestia ignite
```

#### `hestia grow` (New)
Intelligently add capabilities based on current state:

```bash
$ hestia grow

📈 Entity Growth Planner

Current: ALIVE (Basic AI Entity)
Target:  FULL (Complete Sovereign Infrastructure)

Missing Organs:
  - Legs (Reverse Proxy + Tunnel)
  - Builder (Website Generator)
  - Eyes (RSS Server)

Growth Plan:
  Phase 1: hestia tunnel setup
  Phase 2: hestia deploy
  Phase 3: hestia add rss-server

Estimated Time: 15 minutes
Proceed? [Y/n]: Y
```

---

## Package Structure Refactor

### Current Structure (Package-Per-Feature)
```
packages/
├── ai/                    # AI utilities
├── cli-consolidated/      # Main CLI
├── core/                  # Core types
├── types/                 # Shared types
├── usb/                   # USB utilities
└── utils/                 # Shared utilities
```

### Proposed Structure (Organ-Per-Package)
```
packages/
├── hestia-cli/            # Main CLI (orchestrator)
│
├── @hestia/brain/         # Synap backend management
│   ├── src/
│   │   ├── install.ts     # Install brain
│   │   ├── configure.ts   # Configure brain
│   │   └── api.ts         # Brain API client
│
├── @hestia/arms/          # AI assistants
│   ├── src/
│   │   ├── openclaude/    # OpenClaude integration
│   │   ├── ollama/        # Ollama integration
│   │   └── mcp/           # MCP server management
│
├── @hestia/legs/          # Network & exposure
│   ├── src/
│   │   ├── traefik/       # Reverse proxy
│   │   ├── tunnel/        # Tunnel management
│   │   └── ssl/           # Certificate management
│
├── @hestia/builder/       # Website & docs
│   ├── src/
│   │   ├── generator/     # Site generator
│   │   ├── deployer/      # Deployment
│   │   └── templates/     # Templates
│
├── @hestia/eyes/          # Data intake
│   ├── src/
│   │   ├── rss/           # RSS server
│   │   ├── connectors/    # External APIs
│   │   └── webhooks/      # Webhook receivers
│
├── @hestia/heart/         # Core infrastructure
│   ├── src/
│   │   ├── docker/        # Docker management
│   │   ├── health/        # Health checks
│   │   └── backup/        # Backup & recovery
│
├── @hestia/dna/           # Config & identity
│   ├── src/
│   │   ├── config/        # Configuration
│   │   ├── credentials/   # Secret management
│   │   └── state/         # State management
│
└── @hestia/usb/           # USB creation
    └── src/
        ├── creator/       # USB creation
        ├── installer/     # OS installation
        └── ventoy/        # Ventoy integration
```

---

## CLI Command Mapping

### Organ Commands

#### Brain Commands
```bash
hestia brain init              # Initialize brain
hestia brain status            # Check brain health
hestia brain backup            # Backup brain data
hestia brain restore           # Restore brain data
hestia brain upgrade           # Upgrade brain
```

#### Arms Commands
```bash
hestia arms install            # Install AI assistant
hestia arms configure          # Configure AI provider
hestia arms start              # Start AI
hestia arms stop               # Stop AI
hestia arms mcp add <server>   # Add MCP server
```

#### Legs Commands
```bash
hestia legs setup              # Setup reverse proxy
hestia legs tunnel             # Setup tunnel
hestia legs domain             # Configure domain
hestia legs ssl                # Manage certificates
```

#### Builder Commands
```bash
hestia builder init            # Initialize website
hestia builder generate        # Generate site
hestia builder deploy          # Deploy site
hestia builder template        # Choose template
```

#### Eyes Commands
```bash
hestia eyes rss start          # Start RSS server
hestia eyes rss add <feed>     # Add RSS feed
hestia eyes connector add      # Add connector
hestia eyes webhooks           # Manage webhooks
```

### Legacy Command Aliases (Backward Compatibility)
```bash
hestia ai → hestia arms        # Arms command
hestia deploy → hestia builder # Builder command
hestia tunnel → hestia legs    # Legs command
hestia usb → hestia birth      # Birth command
```

---

## Configuration Schema (Entity DNA)

```typescript
interface EntityDNA {
  id: string                    // Unique entity ID
  name: string                  // Entity name
  version: string               // Entity version
  createdAt: Date               // Birth date
  
  organs: {
    brain: BrainConfig
    arms?: ArmsConfig
    legs?: LegsConfig
    builder?: BuilderConfig
    eyes?: EyesConfig
  }
  
  capabilities: string[]        // Enabled features
  
  network: {
    domain?: string
    tunnel?: TunnelConfig
    ssl?: SSLConfig
  }
  
  intelligence?: {
    provider: 'openai' | 'anthropic' | 'ollama'
    model: string
    apiKey?: string
  }
}
```

---

## Success Metrics

### Entity Completeness Score
```typescript
function calculateCompleteness(entity: Entity): number {
  let score = 0
  if (entity.hasBrain) score += 25
  if (entity.hasArms) score += 20
  if (entity.hasLegs) score += 20
  if (entity.hasBuilder) score += 20
  if (entity.hasEyes) score += 15
  return score // 0-100
}
```

### Entity Health Score
```typescript
function calculateHealth(entity: Entity): number {
  const organs = [
    entity.brainHealth,
    entity.armsHealth,
    entity.legsHealth,
    entity.heartHealth,
  ]
  return average(organs) // 0-100
}
```

---

## Roadmap

### Phase 1: Organ Separation (Month 1)
- [ ] Split CLI into organ-specific packages
- [ ] Create `@hestia/brain`, `@hestia/arms`, etc.
- [ ] Implement organ health checks
- [ ] Create organ installation commands

### Phase 2: Entity State (Month 2)
- [ ] Implement entity state machine
- [ ] Create `hestia status` with organ view
- [ ] Add `hestia doctor` diagnostic
- [ ] Build `hestia grow` planner

### Phase 3: Intelligence (Month 3)
- [ ] Make CLI context-aware
- [ ] Suggest next steps based on state
- [ ] Auto-fix common issues
- [ ] Predictive error handling

### Phase 4: Ecosystem (Month 4)
- [ ] Plugin system for custom organs
- [ ] Third-party organ marketplace
- [ ] Organ versioning & updates
- [ ] Entity cloning & migration

---

## Summary

**Hestia is an Entity Creation System.**

Every deployment creates a sovereign digital being with:
- 🧠 **Brain** for intelligence and memory
- 🦾 **Arms** for action and execution
- 🦿 **Legs** for presence and exposure
- 🏗️ **Builder** for creation and generation
- 👁️ **Eyes** for perception and learning
- 🫀 **Heart** for vital infrastructure
- 🧬 **DNA** for identity and configuration

**Three paths to entity creation:**
1. **Minimal:** Brain + Arms + Heart (AI-only)
2. **Full:** Complete entity with all organs
3. **Existing:** Skip birth, awaken on existing server

**The CLI is the midwife** that guides entities from conception to full life.

