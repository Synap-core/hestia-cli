# Hestia Entity Architecture - CORRECTED

## Critical Clarifications

### ❌ Previous Misunderstanding
I previously conflated AI Model with AI Services. These are **separate concerns**:

### ✅ Correct Architecture

#### AI Model (Local Intelligence Engine)
**What:** Ollama, LocalAI, etc. - Runs AI models locally on server
**Purpose:** Local LLM inference (Llama, Mistral, etc.)
**Organ:** Part of the **Brain** (internal intelligence capability)
**Not:** The arms! This is background infrastructure.

#### AI Services (Arms - Action/Execution)
**What:** OpenClaw, OpenClaude - AI coding assistants that USE the AI model
**Purpose:** Execute tasks, generate code, automate via MCP
**Organ:** **Arms** - External action capability
**Connection:** Arms CONNECT TO Brain's AI model

```
Brain (Synap + Ollama/LocalAI)
  └── AI Model running locally
  
Arms (OpenClaw) ──connects to──> Brain's AI Model
  └── MCP servers
  └── Shell execution
  └── Code generation
```

---

## Corrected Organ Mapping

### 🧠 Brain (Core Intelligence + Local AI)
**Components:**
- **Synap Backend** - Core API, identity, memory
- **Ollama/LocalAI** - Local AI model engine (NOT optional for AI path!)
- **PostgreSQL** - Data persistence
- **Redis** - Cache/queue

**Purpose:** 
- Central nervous system
- Local AI inference (if AI path chosen)
- API gateway
- Knowledge graph

**Paths:**
- **All paths include Brain** (required)
- **AI paths add Ollama** to Brain

---

### 🦾 Arms (Action & Execution)
**Implementations:**
- **OpenClaw** (Primary) - AI coding assistant
- **OpenClaude** (Alternative) - Another AI assistant
- **Multiple allowed** - Can have both!

**Purpose:**
- Execute tasks
- Code generation
- MCP (Model Context Protocol) servers
- Shell automation

**Requires:**
- Brain (Synap) for identity
- Brain's AI Model (Ollama) for inference

**Connection:**
```
Arms (OpenClaw) ──API──> Brain (Synap)
     │
     └── Uses Brain's Ollama for LLM inference
```

---

### 🏗️ Builder (Creation & Generation)
**Implementations:**
- **OpenCode** (Primary) - Website/doc generation
- **Alternative builders** - Could be swapped

**Purpose:**
- Generate websites
- Deploy documentation
- Create outer shell/presence

**Connection:**
```
Builder (OpenCode) ──API──> Brain (Synap)
     │
     └── Uses Arms for AI-assisted generation (optional)
```

---

### 📚 Docploy (Documentation Bridge)
**What:** Doc deployment automation
**Position:** Between Builder and Legs
**Purpose:** 
- Deploy docs to hosting
- Bridge between generation and exposure
- CI/CD for documentation

**Flow:**
```
Builder generates docs
    ↓
Docploy deploys docs
    ↓
Legs expose to world
```

---

### 👁️ Eyes (Perception - RSS)
**Implementation:**
- **RSSHub** (Primary) - RSS feed aggregator
- Supports: FreshRSS, Miniflux, custom providers

**Purpose:**
- Consume external knowledge
- RSS feed aggregation
- Webhook receivers
- API connectors

**Connection:**
```
Eyes (RSSHub) ──API──> Brain (Synap)
     │
     └── Stores consumed knowledge in Brain
```

---

### 🦿 Legs (Presence & Exposure)
**Components:**
- **Traefik** - Reverse proxy
- **Tunnel** - Pangolin/Cloudflare (optional)
- **SSL** - Certificate management

**Purpose:**
- Expose entity to world
- Route traffic
- SSL termination

**Connection:**
```
Internet ──> Legs (Traefik) ──> Brain (Synap API)
                         ──> Builder (Website)
                         ──> Eyes (RSSHub)
                         ──> Arms (OpenClaw UI)
```

---

## Three Paths - CORRECTED

### Path 1: Minimal (Just Infrastructure)
**Use Case:** User wants just Synap (notes, tasks, data) - NO AI

```
USB → OS Install → Phase 1 (Docker/Base)
                      ↓
              Phase 2 (Core Services)
                      ↓
              [Brain only]
              - Synap Backend
              - PostgreSQL
              - Redis
              - NO Ollama
              - NO Arms
              - NO Builder
              
Result: Personal data infrastructure, no AI
```

**Command:**
```bash
hestia install all --profile minimal
```

---

### Path 2: AI Entity (Full with Local AI)
**Use Case:** User wants AI assistant running locally

```
USB → OS Install → Phase 1 (Docker/Base)
                      ↓
              Phase 2 (Core Services)
                      ↓
              Phase 3-AI (AI Infrastructure)
                      ↓
              [Complete Entity]
              
Brain:
  - Synap Backend
  - Ollama (local AI model) ← KEY DIFFERENCE
  - PostgreSQL, Redis
  
Arms:
  - OpenClaw (AI coding assistant)
  - MCP servers
  
Builder:
  - OpenCode (website generation)
  
Docploy:
  - Documentation deployment
  
Eyes:
  - RSSHub (RSS aggregation)
  
Legs:
  - Traefik (reverse proxy)
  - Optional: Tunnel
```

**Key:** Ollama runs AI model LOCALLY on server. Arms (OpenClaw) connect to it.

**Command:**
```bash
hestia install all --profile ai-full
```

---

### Path 3: AI-Only (AI Model Only)
**Use Case:** Developer just wants local AI (Ollama), nothing else

```
USB → OS Install → Phase 1 (Docker/Base)
                      ↓
              [Brain minimal]
              - Ollama only
              - NO Synap
              - NO Arms
              - NO Builder
              
Result: Just local AI inference endpoint
```

**Command:**
```bash
hestia install all --profile ai-only
```

---

### Path 4: Existing Server (Skip USB/OS)
**Same as Path 2, but skip birth phase**

---

## Interchangeable Parts Architecture

### The Goal: Modular Organs

Each organ can be swapped for alternatives:

#### Brain AI Engine (Swappable)
```yaml
brain:
  ai_engine:
    # Option 1: Ollama (default)
    type: ollama
    model: llama3.1:8b
    
    # Option 2: LocalAI
    type: localai
    model: mistral-7b
    
    # Option 3: None (no local AI)
    type: none
```

#### Arms (Multiple Allowed)
```yaml
arms:
  # Can have multiple arms!
  providers:
    - type: openclaw
      enabled: true
      
    - type: openclaude  
      enabled: true
      
    - type: custom
      enabled: false
```

#### Builder (Swappable)
```yaml
builder:
  # Option 1: OpenCode (default)
  type: opencode
  
  # Option 2: Custom builder
  type: custom
  image: my-builder:latest
```

#### Eyes (Swappable)
```yaml
eyes:
  # Option 1: RSSHub (default)
  type: rsshub
  
  # Option 2: FreshRSS
  type: freshrss
  
  # Option 3: Miniflux
  type: miniflux
```

#### Legs (Swappable)
```yaml
legs:
  proxy:
    # Option 1: Traefik (default)
    type: traefik
    
    # Option 2: Nginx
    type: nginx
    
  tunnel:
    # Option 1: Pangolin
    type: pangolin
    
    # Option 2: Cloudflare
    type: cloudflare
    
    # Option 3: None (local only)
    type: none
```

---

## Simplified Recommendation: Focus on ONE Path

### The Problem
More options = more complexity:
- Multiple AI engines to maintain
- Multiple arms to integrate
- Multiple RSS providers to support
- Complex connection matrix

### Recommended: AI-First Path (Path 2)

**Standardize on:**
- **Brain:** Synap + Ollama (llama3.1:8b default)
- **Arms:** OpenClaw (primary), OpenClaude (secondary)
- **Builder:** OpenCode
- **Docploy:** Integrated with OpenCode
- **Eyes:** RSSHub
- **Legs:** Traefik + optional tunnel

**Why this path:**
1. **Complete entity** - All organs present
2. **Local-first** - Privacy, no API keys needed
3. **Extensible** - Add more arms later
4. **Documented** - One clear path to support

**Future expansion:** After solidifying this path, add alternatives.

---

## Connection Architecture

### How Organs Connect

```
┌─────────────────────────────────────────────────────────────┐
│                         INTERNET                            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  LEGS (Traefik)                                             │
│  - Routes: /api/* → Brain                                   │
│           /ai/*   → Arms                                    │
│           /docs/* → Builder                                 │
│           /rss/*  → Eyes                                    │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌──────────────┐ ┌──────────┐ ┌──────────┐
│   BRAIN      │ │  ARMS    │ │ BUILDER  │
│ (Synap)      │ │(OpenClaw)│ │(OpenCode)│
│              │ │          │ │          │
│ ┌──────────┐ │ │          │ │          │
│ │ Ollama   │◀┼─┘          │ │          │
│ │(AI Model)│ │            │ │          │
│ └──────────┘ │            │ │          │
└──────┬───────┘            │ │          │
       │                     │ │          │
       │   ┌─────────────────┘ │          │
       │   │                   │          │
       ▼   ▼                   ▼          ▼
┌─────────────────────────────────────────────────────────────┐
│  SHARED INFRASTRUCTURE                                      │
│  - PostgreSQL (Brain data)                                  │
│  - Redis (Cache/Queue)                                      │
│  - Minio (Object storage)                                   │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

#### Arms Using Brain's AI:
```
1. User asks OpenClaw to "write a function"
2. OpenClaw (Arms) sends request to Brain API
3. Brain forwards to Ollama (local AI model)
4. Ollama generates code locally
5. Brain returns to OpenClaw
6. OpenClaw presents to user
```

#### Eyes Feeding Brain:
```
1. RSSHub (Eyes) fetches RSS feed
2. Parses and structures content
3. Sends to Brain API
4. Brain stores in knowledge graph
5. Available for Arms to query
```

#### Builder Creating Content:
```
1. User requests website via OpenCode (Builder)
2. Builder queries Brain for content
3. Optionally uses Arms for AI generation
4. Generates static site
5. Docploy deploys
6. Legs (Traefik) serves
```

---

## Implementation Priority (Focus Path)

### Phase 1: Core Brain with Ollama
- [ ] Synap Backend container
- [ ] Ollama container (llama3.1:8b default)
- [ ] PostgreSQL + Redis
- [ ] Basic hestia brain init command

### Phase 2: Arms (OpenClaw)
- [ ] OpenClaw container
- [ ] MCP server integration
- [ ] Connection to Brain's Ollama
- [ ] hestia arms install command

### Phase 3: Builder (OpenCode)
- [ ] OpenCode container
- [ ] Website generation
- [ ] Connection to Brain API
- [ ] hestia builder init command

### Phase 4: Docploy Integration
- [ ] Docploy for deployment
- [ ] CI/CD pipeline
- [ ] hestia builder deploy command

### Phase 5: Eyes (RSSHub)
- [ ] RSSHub container
- [ ] Feed configuration
- [ ] Connection to Brain
- [ ] hestia eyes install command

### Phase 6: Legs (Traefik)
- [ ] Traefik container
- [ ] SSL certificates
- [ ] Domain routing
- [ ] hestia legs setup command

### Phase 7: Entity State
- [ ] Entity state tracking
- [ ] hestia status command
- [ ] hestia doctor command
- [ ] Organ health checks

---

## Summary

### Key Corrections
1. ✅ **AI Model (Ollama) ≠ Arms** - Ollama is part of Brain
2. ✅ **OpenClaw = Arms** - AI coding assistant
3. ✅ **OpenCode = Builder** - Website generation
4. ✅ **Docploy = Bridge** - Between builder and legs
5. ✅ **RSSHub = Eyes** - RSS aggregation
6. ✅ **Focus on ONE path** - AI-First entity

### Standard Stack (Focus Path)
- **Brain:** Synap + Ollama
- **Arms:** OpenClaw (can add OpenClaude later)
- **Builder:** OpenCode
- **Docploy:** Integrated
- **Eyes:** RSSHub
- **Legs:** Traefik

### Why This Matters
- **Clear mental model** - Each organ has ONE primary implementation
- **Reduced complexity** - Don't maintain multiple integrations
- **Better UX** - One clear path to success
- **Easier docs** - Document one flow thoroughly

**Next step:** Build Path 2 (AI Entity) completely before adding alternatives.

