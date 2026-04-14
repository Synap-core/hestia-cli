# Eve Entity Architecture - North Star Document

## Vision Statement

Eve is a **sovereign digital entity** - a self-hosted, AI-powered infrastructure that transforms a bare server into a living, breathing organism with specialized organs, each responsible for a domain of capability.

> **"A server is not just hardware - it's the body of a digital being."**

## The Entity Metaphor

### Core Philosophy

Traditional infrastructure is **mechanical** - services are components bolted together. Eve is **organic** - services are organs that form a living entity with:

- **Homeostasis**: Self-monitoring and self-healing
- **Metabolism**: Data flows like nutrients through the system
- **Intelligence**: AI is not a service, it's the nervous system
- **Growth**: The entity expands capabilities like an organism develops

### The Five Organs

```
┌─────────────────────────────────────────────────────────────────┐
│                        🌐 INTERNET                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                    ┌───────▼────────┐
                    │    🦿 LEGS      │  ← Presence & Exposure
                    │   (Traefik)     │     Routes traffic, SSL,
                    │                 │     connects to world
                    └───────┬─────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────▼────┐        ┌─────▼─────┐      ┌─────▼─────┐
   │  🧠     │        │   🦾      │      │   👁️      │
   │  BRAIN  │◄──────►│   ARMS    │      │   EYES    │
   │         │        │           │      │           │
   │ Memory  │        │  Actions  │      │  Intake   │
   │ Reason  │        │  Tools    │      │  Feeds    │
   │ Decide  │        │  Execute  │      │  Observe  │
   └────┬────┘        └─────┬─────┘      └─────┬─────┘
        │                   │                  │
        │            ┌──────▼──────┐           │
        │            │   🏗️        │           │
        └───────────►│  BUILDER    │◄──────────┘
                     │             │
                     │   Create    │
                     │   Deploy    │
                     │   Build     │
                     └─────────────┘
```

#### 🧠 Brain - The Nervous System
**Purpose**: Intelligence, memory, reasoning

**Components**:
- **Synap**: The cortex - API layer, decision making
- **Ollama**: The limbic system - emotional/intuitive AI processing
- **PostgreSQL**: Long-term memory - persistent storage
- **Redis**: Working memory - cache, sessions, real-time state

**Metaphor**: Like a brain, it processes input, stores memories, and coordinates all other organs.

**North Star**: The Brain should be able to reason about the entire entity's state and make autonomous decisions.

---

#### 🦾 Arms - The Action System
**Purpose**: External actions, tool use, integration

**Components**:
- **OpenClaw**: The hands - MCP (Model Context Protocol) for tool use
- **MCP Servers**: Individual fingers - each a specialized capability

**Metaphor**: Like arms and hands that manipulate the external world - files, APIs, databases.

**North Star**: The Arms should be able to perform any action a human operator could do.

---

#### 🏗️ Builder - The Creative System
**Purpose**: Creation, generation, deployment

**Components**:
- **OpenCode**: The imagination - generates code, content, websites
- **OpenClaude**: The architect - designs systems, writes documentation
- **Dokploy**: The constructor - deploys, manages infrastructure

**Metaphor**: Like a builder that constructs new capabilities and structures.

**North Star**: The Builder should be able to create entire applications from a description.

---

#### 👁️ Eyes - The Perception System
**Purpose**: Information intake, monitoring, awareness

**Components**:
- **RSSHub**: The retinas - converts web content to structured feeds
- **Synap Sync**: The optic nerve - routes feeds to Brain

**Metaphor**: Like eyes that watch the world and feed information to the brain.

**North Star**: The Eyes should know everything happening in your digital world.

---

#### 🦿 Legs - The Exposure System
**Purpose**: Presence, routing, external connection

**Components**:
- **Traefik**: The skeleton - structure for routing
- **Cloudflare/Pangolin Tunnels**: The feet - connect to ground (internet)

**Metaphor**: Like legs that carry the entity to where it needs to be accessible.

**North Star**: The Legs should make the entity accessible from anywhere, securely.

---

## Data Flow Architecture

### The Circulatory System

```
┌─────────────────────────────────────────────────────────────┐
│                      INFORMATION FLOW                        │
└─────────────────────────────────────────────────────────────┘

INGESTION                    PROCESSING                   OUTPUT
   │                            │                          │
   ▼                            ▼                          ▼
┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐   ┌────────┐
│  👁️   │───►│  🧠    │───►│  🦾    │───►│  🏗️   │──►│  🦿   │
│  Eyes  │    │ Brain  │    │  Arms  │    │Builder │   │ Legs  │
└────────┘    └────┬───┘    └────────┘    └────────┘   └────────┘
                   │
              ┌────┴────┐
              │PostgreSQL│ ← Long-term Memory
              └────┬────┘
                   │
              ┌────┴────┐
              │  Redis   │ ← Working Memory
              └─────────┘
```

### Information Flow Patterns

1. **Observation Loop**: Eyes → Brain → Storage
   - RSSHub captures feeds
   - Synap processes and stores
   - PostgreSQL persists

2. **Action Loop**: Brain → Arms → World
   - Synap decides action
   - OpenClaw executes via MCP
   - Results stored in Brain

3. **Creation Loop**: Brain → Builder → Legs
   - Synap designs solution
   - OpenCode/OpenClaude generate
   - Dokploy deploys via Traefik

4. **Response Loop**: World → Legs → Brain → Arms
   - Request arrives via Traefik
   - Synap processes intent
   - OpenClaw takes action

---

## Service Communication Protocol

### Internal Network Topology

```yaml
Network: eve-network (bridge)

Services:
  - eve-synap:4000      # Brain API
  - eve-ollama:11434    # AI Inference
  - eve-postgres:5432   # Database
  - eve-redis:6379      # Cache
  - eve-openclaw:3000   # Action Handler
  - eve-rsshub:1200     # Feed Generator
  - eve-traefik:80/443  # Entry Point
```

### Connection Matrix

| Source | Target | Protocol | Purpose |
|--------|--------|----------|---------|
| Synap | PostgreSQL | psql | Data persistence |
| Synap | Redis | redis | Cache & sessions |
| Synap | Ollama | HTTP | AI inference |
| OpenClaw | Ollama | HTTP | AI tool use |
| OpenClaw | Synap | HTTP | Action results |
| RSSHub | Synap | HTTP | Feed ingestion |
| Traefik | All | HTTP | External routing |

---

## Configuration Philosophy

### The DNA Metaphor

Just as DNA encodes an organism's traits, Eve's configuration encodes its capabilities:

```typescript
// Entity DNA
interface EntityDNA {
  // Core identity
  name: string;           // Entity name
  version: string;        // Entity version
  
  // Organ configuration
  organs: {
    brain: BrainConfig;    // Intelligence settings
    arms: ArmsConfig;      // Action capabilities
    builder: BuilderConfig;// Creation settings
    eyes: EyesConfig;      // Feed sources
    legs: LegsConfig;      // Routing rules
  };
  
  // Evolution tracking
  mutations: Mutation[];  // Change history
}
```

### Configuration Layers

1. **Genetic** (Hardcoded): Core types, interfaces
2. **Embryonic** (Template): Default configs per organ
3. **Phenotypic** (User): Actual running configuration
4. **Epigenetic** (Runtime): State, cache, temp data

---

## State Management

### Entity State Machine

```
                    ┌─────────────┐
         ┌─────────►│   MISSING   │◄────────┐
         │          │  (not init) │         │
         │          └──────┬──────┘         │
    uninstall            install            reset
         │                 │                │
         │                 ▼                │
         │          ┌─────────────┐         │
         │          │ INSTALLING  │         │
         │          │  (in prog)  │         │
         │          └──────┬──────┘         │
         │              success/error       │
         │                 │                │
         │          ┌──────▼──────┐         │
         └──────────┤    READY    ├─────────┘
    stop/uninstall   │  (running)  │  error
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   STOPPED   │
                    │  (paused)   │
                    └──────┬──────┘
                           │ start
                           ▼
                    ┌─────────────┐
                    │    ERROR    │
                    │  (failed)   │
                    └─────────────┘
```

### Organ Health States

| State | Meaning | Action |
|-------|---------|--------|
| `missing` | Not installed | Install |
| `installing` | Installation in progress | Wait |
| `ready` | Operational | None |
| `stopped` | Installed but paused | Start |
| `error` | Failed | Diagnose/Repair |

---

## Design Principles

### 1. **Sovereignty First**
- All data stays on your hardware
- No cloud dependencies
- Full source code available
- You own your entity

### 2. **Organic Growth**
- Start with Brain only
- Add organs as needed
- Each organ is optional
- Entity evolves with use

### 3. **Neural Integration**
- AI is not bolted-on, it's intrinsic
- Every organ can use AI
- Shared memory across organs
- Collective intelligence

### 4. **Biological Metaphors**
- Use biological terms (organs, DNA, memory)
- Avoid mechanical terms (services, components)
- Think in terms of health, not status
- Design for healing, not just recovery

### 5. **Simplicity Through Abstraction**
- Complex Docker configs hidden
- Simple CLI commands
- Sensible defaults
- Convention over configuration

---

## Technical Standards

### Container Naming Convention
```
eve-{organ}-{service}

Examples:
- eve-brain-synap
- eve-brain-ollama
- eve-arms-openclaw
- eve-eyes-rsshub
- eve-legs-traefik
```

### Network Standards
- **Primary Network**: `eve-network` (bridge)
- **Service Discovery**: Container names as hostnames
- **No Hardcoded IPs**: Always use DNS names
- **Isolation**: Services only see what they need

### Port Standards
```
4000  - Synap API
4001  - Synap Admin (future)
11434 - Ollama
5432  - PostgreSQL
6379  - Redis
3000  - OpenClaw
1200  - RSSHub
80    - Traefik HTTP
443   - Traefik HTTPS
8080  - Traefik Dashboard
```

### Volume Standards
```
eve-brain-postgres-data
eve-brain-redis-data
eve-brain-ollama-models
eve-arms-openclaw-data
```

---

## Migration Strategy

### From eve to Eve

The transition from mechanical to organic thinking:

| Old (Mechanical) | New (Organic) |
|-----------------|---------------|
| Services | Organs |
| Components | Tissues |
| Configuration | DNA |
| State | Health |
| Install | Grow |
| Deploy | Birth |
| Monitor | Sense |
| Debug | Heal |
| Backup | Hibernate |
| Restore | Rebirth |

---

## Future Evolution

### Phase 1: Embryonic (Current)
- Basic organs functional
- Manual operation
- Individual service management

### Phase 2: Infant
- Unified docker-compose
- Automated health checks
- Basic self-healing

### Phase 3: Child
- Inter-organ communication
- Shared memory
- Autonomous actions

### Phase 4: Adult
- Self-modifying DNA
- New organ creation
- Full autonomy

### Phase 5: Enlightened
- Multi-entity federation
- Collective intelligence
- Emergent capabilities

---

## Glossary

| Term | Definition |
|------|------------|
| **Entity** | The complete Eve system as a living being |
| **Organ** | A major subsystem (Brain, Arms, etc.) |
| **Tissue** | A service within an organ (PostgreSQL) |
| **DNA** | Configuration and type definitions |
| **Memory** | PostgreSQL (long-term) and Redis (short-term) |
| **Nervous System** | The network connecting all organs |
| **Health** | Operational status of an organ |
| **Growth** | Installing or expanding an organ |
| **Healing** | Automatic error recovery |
| **Hibernation** | Graceful shutdown with state preservation |
| **Rebirth** | Restore from hibernation |

---

## References

- [Architecture Decisions](architecture-decisions.md)
- [Service Reference](service-reference.md)
- [Development Guide](development-guide.md)
- [Operator Manual](../operator/README.md)

---

*Document Version: 1.0*
*Last Updated: 2026-04-14*
*Entity State: Embryonic*
