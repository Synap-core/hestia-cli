# Technical Decision Document - Hestia Deployment Architecture

## Decisions to Validate

### 1. Deployment Platform: Dockploy vs Coolify vs Native

**Dockploy**
- Pros: Built for Docker, automatic SSL, domain management
- Cons: Less known, smaller community

**Coolify**
- Pros: Open-source, simpler UX, self-hosted, large community, supports Docker Compose
- Cons: Less control than native

**Native (Traefik + Custom)**
- Pros: Full control, integrated with CLI
- Cons: More maintenance, complex setup

**Recommendation**: Start with **Coolify** for MVP (simpler for users), migrate to native later if needed.

### 2. Reverse Proxy: Traefik (Confirmed)
- Traefik for dynamic routing
- Docker labels for configuration
- Automatic Let's Encrypt

### 3. AI Platform Choice
**Structure**:
```yaml
# User can choose:
option_1:
  name: "OpenCode"
  description: "Web-based IDE, best for collaboration"
  docker: true
  
option_2:
  name: "OpenClaude"  
  description: "CLI-based, best for automation"
  docker: false  # Local CLI
  
option_3:
  name: "Both"
  description: "Use OpenCode for dev + OpenClaude for automation"
```

### 4. OpenCode Architecture
**Two modes**:
1. **Docker Mode** (default): Runs in container, accessible via browser
2. **External Mode**: User installs CLI locally, connects via API

**For Agent Usage**:
- Must expose API endpoints
- Docker mode preferred for isolation
- Can be controlled by other agents via REST API

### 5. Website Template Strategy

**Repo**: `github.com/synap-core/synap-starter-website`

**Features**:
- Next.js 14 + TypeScript
- @synap/ui-system components
- @synap/hooks for data
- @synap/cell-runtime for widgets
- Pre-configured pages:
  - Landing (marketing)
  - Dashboard (data views)
  - Profile (user settings)
  - Search (Typesense)
  - Settings (workspace config)

**Deployment**:
- Dockerized
- Integrated in Coolify/Dockploy
- Auto-connects to Synap backend

## Implementation Plan

### Phase 1: Core Deployment (Priority: CRITICAL)
**Agent Tasks** (parallel where possible):

1. **Agent A**: Create `hestia deploy` command
   - Generate docker-compose with Traefik
   - Integrate Coolify/Dockploy
   - Setup automatic domain + SSL

2. **Agent B**: Create `synap-starter-website` repo
   - Next.js template
   - Synap SDK integration
   - Docker configuration

3. **Agent C**: Integrate OpenCode
   - Docker service definition
   - API for external agents
   - Configuration sync

### Phase 2: AI Platform Integration
4. **Agent D**: OpenCode service
   - Docker compose service
   - Traefik routing
   - Synap workspace connection

5. **Agent E**: OpenClaude integration  
   - CLI wrapper
   - State manager sync
   - Profile configuration

### Phase 3: Website Generation
6. **Agent F**: Website deployment
   - Clone template
   - Configure env vars
   - Deploy via Coolify/Dockploy
   - Connect domain

## Technology Validation Needed

Before implementing, validate:

1. **Coolify vs Dockploy POC**
   - Deploy test Synap instance on both
   - Compare UX and features
   - Decide in 2 hours max

2. **OpenCode Docker Mode**
   - Can it run fully in Docker?
   - Does API expose enough for agents?
   - Test connection to Synap

3. **Traefik + Coolify Integration**
   - Can they work together?
   - Or does Coolify replace Traefik?

## Decision Points

**Q1: Coolify or Dockploy or Both?**
- A) Coolify only (simpler)
- B) Dockploy only (more control)
- C) Support both (more complex)
- D) Native Traefik only (most control)

**Q2: OpenCode default mode?**
- A) Docker (containerized, easier)
- B) External CLI (more powerful)
- C) Both options

**Q3: Website template?**
- A) Separate repo (recommended)
- B) Inside CLI package
- C) Generated from scratch

**Q4: Priority order?**
- A) Deploy → Website → OpenCode
- B) Deploy → OpenCode → Website  
- C) All parallel (need more agents)

Please confirm decisions so I can dispatch agents.
