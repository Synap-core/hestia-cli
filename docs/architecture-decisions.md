# Architecture Decision Records (ADRs)

This document records significant architectural decisions made in the Eve project.

## ADR-001: Entity Metaphor for Infrastructure

**Status**: Accepted

**Context**: We needed a way to make infrastructure management more intuitive and to guide design decisions.

**Decision**: Adopt a biological metaphor where the infrastructure is a "digital entity" with organs (services), DNA (configuration), memory (storage), and a nervous system (network).

**Consequences**:
- (+) More intuitive mental model
- (+) Clear boundaries between components
- (+) Guides naming and organizational decisions
- (-) May be confusing to users expecting traditional terminology
- (-) Some concepts don't map perfectly to biology

---

## ADR-002: Docker as the Organ Container

**Status**: Accepted

**Context**: Services need isolation, reproducibility, and easy management.

**Decision**: Use Docker containers as the fundamental unit for each service (organ tissue). Each organ consists of one or more containers.

**Consequences**:
- (+) Consistent runtime environment
- (+) Easy installation/removal of organs
- (+) Resource isolation
- (-) Additional resource overhead
- (-) Docker dependency

---

## ADR-003: Single Docker Network

**Status**: Accepted

**Decision**: All services communicate over a single Docker bridge network named `hestia-network`.

**Rationale**: 
- Simplifies service discovery (DNS by container name)
- Reduces configuration complexity
- All organs need to communicate with Brain

**Consequences**:
- (+) Simple networking model
- (+) Easy inter-service communication
- (-) No network-level isolation between organs
- (-) Flat network topology

---

## ADR-004: Brain as Central Hub

**Status**: Accepted

**Decision**: The Brain (Synap) is the central coordination point. All organs report to and receive instructions from the Brain.

**Rationale**:
- Mimics biological brains
- Provides single source of truth
- Enables coordinated actions

**Consequences**:
- (+) Clear architecture
- (+) Centralized state
- (-) Brain is a single point of failure
- (-) Network partition can disable entity

**Mitigation**: Brain can run in HA mode with multiple instances (future).

---

## ADR-005: PostgreSQL + Redis Memory Model

**Status**: Accepted

**Decision**: Use PostgreSQL for long-term memory (persistent data) and Redis for working memory (cache, sessions).

**Rationale**:
- Mimics biological memory types
- PostgreSQL for durability and complex queries
- Redis for speed and ephemeral data

**Consequences**:
- (+) Appropriate tool for each use case
- (+) Biological metaphor holds
- (-) Two databases to manage
- (-) Data consistency concerns

---

## ADR-006: Ollama for Local AI

**Status**: Accepted

**Decision**: Use Ollama as the default AI inference engine, running locally.

**Rationale**:
- Sovereignty: No data leaves the server
- Cost: No API fees
- Privacy: Complete data control

**Consequences**:
- (+) Full data sovereignty
- (+) No ongoing API costs
- (+) Works offline
- (-) Requires significant compute resources
- (-) Model selection limited to open source
- (-) Slower than cloud APIs on weak hardware

**Alternative Considered**: OpenAI API - rejected due to sovereignty requirements.

---

## ADR-007: Traefik for Reverse Proxy

**Status**: Accepted

**Decision**: Use Traefik as the reverse proxy and SSL terminator.

**Rationale**:
- Native Docker integration
- Automatic SSL with Let's Encrypt
- Dynamic configuration
- Modern and actively maintained

**Consequences**:
- (+) Automatic service discovery
- (+) Easy SSL management
- (+) Dashboard for monitoring
- (-) Learning curve for complex routing
- (-) Less mature than Nginx

**Alternatives Considered**:
- Nginx: Rejected - less dynamic, more config
- Caddy: Considered - simpler but less Docker-native

---

## ADR-008: TypeScript + ESM for CLI

**Status**: Accepted

**Decision**: Implement CLI in TypeScript using ES Modules.

**Rationale**:
- Type safety
- Modern JavaScript features
- Consistent with Synap codebase
- Tree-shaking for smaller bundles

**Consequences**:
- (+) Type safety
- (+) Modern codebase
- (-) Build step required
- (-) ESM compatibility issues with some packages

---

## ADR-009: Monorepo with pnpm Workspaces

**Status**: Accepted

**Decision**: Use pnpm workspaces for the monorepo structure.

**Rationale**:
- Efficient disk usage (content-addressable store)
- Fast installations
- Good workspace support
- Native ESM support

**Consequences**:
- (+) Fast builds
- (+) Disk efficient
- (+) Native ESM
- (-) Another package manager to learn
- (-) Not as ubiquitous as npm/yarn

**Alternatives Considered**:
- npm workspaces: Slower, less efficient
- Yarn workspaces: Good but no significant advantage

---

## ADR-010: CLI Tool Pattern for Builder

**Status**: Provisional

**Decision**: Builder services (OpenCode, OpenClaude, Dokploy) are installed as CLI tools rather than containers.

**Rationale**:
- These are development tools used by humans
- Need access to host filesystem for development
- Lower resource usage

**Consequences**:
- (+) Direct filesystem access
- (+) Lower resource usage
- (+) Familiar CLI interface
- (-) Inconsistent with containerized services
- (-) Version management complexity
- (-) No isolation

**Future Consideration**: May containerize these services for consistency.

---

## ADR-011: Zod for Configuration Validation

**Status**: Accepted

**Decision**: Use Zod for runtime configuration validation.

**Rationale**:
- TypeScript-native
- Runtime validation with type inference
- Good error messages
- Active development

**Consequences**:
- (+) Runtime type safety
- (+) Good DX
- (-) Additional dependency
- (-) Schema duplication with TypeScript types

---

## ADR-012: File-Based State Management

**Status**: Accepted

**Decision**: Store entity state in JSON files (`~/.local/share/hestia/state.json`).

**Rationale**:
- Simple to implement
- Human-readable
- Easy to backup/restore
- No additional database needed

**Consequences**:
- (+) Simple
- (+) Human-readable
- (+) Easy backup
- (-) Not suitable for concurrent access
- (-) No query capabilities
- (-) File corruption risk

**Future Consideration**: May move to SQLite or PostgreSQL for larger entities.

---

## ADR-013: MCP for AI Tool Use

**Status**: Accepted

**Decision**: Use Model Context Protocol (MCP) for AI tool integration in Arms (OpenClaw).

**Rationale**:
- Open standard
- Growing ecosystem of servers
- Type-safe tool definitions
- Multiple AI provider support

**Consequences**:
- (+) Standard protocol
- (+) Growing ecosystem
- (+) Type-safe
- (-) New protocol, still evolving
- (-) Requires MCP server infrastructure

---

## ADR-014: RSSHub for Feed Aggregation

**Status**: Accepted

**Decision**: Use RSSHub for converting web services to RSS feeds.

**Rationale**:
- Supports 1000+ sources
- Self-hosted
- Open source
- Extensive customization

**Consequences**:
- (+) Massive source coverage
- (+) Self-hosted
- (+) Active community
- (-) Resource intensive for many feeds
- (-) Rate limiting concerns

---

## ADR-015: Consistent Naming Convention

**Status**: Accepted

**Decision**: Use the naming convention: `hestia-{organ}-{service}`

**Examples**:
- `hestia-brain-synap`
- `hestia-brain-ollama`
- `hestia-arms-openclaw`

**Rationale**:
- Clear identification
- Easy filtering (`docker ps | grep hestia`)
- Hierarchical organization

**Consequences**:
- (+) Clear identification
- (+) Easy management
- (-) Longer names
- (-) Some services may not fit organ model perfectly

---

## ADR-016: GitHub Container Registry

**Status**: Accepted

**Decision**: Use GitHub Container Registry (ghcr.io) for custom images.

**Rationale**:
- Integrated with GitHub
- Free for public repos
- Good for automated builds
- Versioning via git tags

**Consequences**:
- (+) Integrated workflow
- (+) Free public hosting
- (+) Versioning
- (-) GitHub dependency
- (-) Rate limits for unauthenticated pulls

---

## ADR-017: Native child_process Over execa

**Status**: Accepted

**Decision**: Use Node.js native `child_process` instead of `execa` for CLI execution.

**Rationale**:
- ESM bundling issues with execa
- Native module is sufficient
- Reduces dependencies
- Better control over execution

**Consequences**:
- (+) No bundling issues
- (+) Fewer dependencies
- (+) More control
- (-) More verbose code
- (-) Must handle edge cases manually

---

## Rejected Decisions

### Kubernetes for Orchestration

**Status**: Rejected

**Rationale**: Too complex for the target use case. Docker Compose is sufficient for single-node deployments.

**May Reconsider**: When multi-node support is needed.

---

### Cloud AI APIs as Default

**Status**: Rejected

**Rationale**: Violates sovereignty principle. May be offered as opt-in for users who need more power.

---

### Centralized Configuration Database

**Status**: Rejected

**Rationale**: Overkill for current needs. File-based config is sufficient and simpler.

**May Reconsider**: When managing hundreds of entities.

---

## Pending Decisions

### Backup Strategy

**Options**:
1. File-based backup (volumes + state files)
2. Database dumps + volume snapshots
3. Incremental sync to remote

**Status**: Under discussion

---

### Multi-Entity Federation

**Question**: How do multiple Eve entities communicate?

**Status**: Future consideration

---

### AI Model Selection Strategy

**Question**: How to select optimal model for task?

**Options**:
1. User-defined default
2. Task-based routing
3. Performance-based selection
4. Cost/quality tradeoff

**Status**: Under discussion
