# Project Hestia - Complete Audit & Integration Plan

**Date:** 2026-04-12  
**Auditor:** OpenCode  
**Scope:** Full technical audit, gap analysis, and integration roadmap

---

## Executive Summary

After examining **OpenClaude** (GitHub/Gitlawb) and **OpenClaw** (openclaw.ai), we discovered mature, battle-tested solutions that solve many of our planned features. Instead of reinventing, we should **integrate** these tools and focus on the unique value-add: **Hestia as the sovereign infrastructure orchestrator** that connects, configures, and manages these components in a unified, entity-first system.

### Key Findings:
- ✅ **OpenClaude** - Already has: multi-provider AI, coding tools, MCP support, VS Code extension
- ✅ **OpenClaw** - Already has: personal assistant, comms integration (Telegram/WhatsApp), skills system, persistent memory
- ❌ **Missing** - Unified CLI that orchestrates both, connects to Synap Backend, manages state
- ❌ **Missing** - Entity-first integration with temporal knowledge graph
- ❌ **Missing** - Installation/orchestration layer

---

## 1. External Resource Analysis

### 1.1 OpenClaude (github.com/Gitlawb/openclaude)

**What it is:** Open-source coding agent CLI (20.7k stars, 7.2k forks)

**Capabilities:**
- ✅ **Multi-provider AI** - 200+ models via OpenAI-compatible APIs
- ✅ **Tools** - bash, file read/write/edit, grep, glob, agents, MCP, slash commands
- ✅ **Streaming responses** - Real-time token output
- ✅ **Tool calling** - Multi-step tool loops
- ✅ **Images** - URL and base64 vision support
- ✅ **Provider profiles** - `.openclaude-profile.json` with guided setup
- ✅ **Agent routing** - Different agents → different models
- ✅ **VS Code extension** - Full IDE integration
- ✅ **Headless gRPC server** - For programmatic access
- ✅ **Web search** - DuckDuckGo + Firecrawl support

**Architecture:**
```
TypeScript/Bun runtime
├── CLI (interactive)
├── gRPC server (headless)
├── Provider abstraction layer
├── Tool execution engine
└── VS Code extension
```

**Configuration:**
- Environment variables or `.openclaude-profile.json`
- Provider routing in `~/.claude/settings.json`
- Supports per-agent model selection

---

### 1.2 OpenClaw (openclaw.ai)

**What it is:** Personal AI assistant that runs on YOUR computer

**Capabilities:**
- ✅ **Comms integration** - WhatsApp, Telegram, Discord, iMessage
- ✅ **Persistent memory** - Remembers everything across sessions
- ✅ **Proactive AI** - Cron jobs, reminders, background tasks
- ✅ **Skills system** - Custom extensions/plugins
- ✅ **Computer control** - Mouse, keyboard, screenshots
- ✅ **Heartbeat system** - Health checks and status updates
- ✅ **Sub-agents** - Can spawn and manage other agents
- ✅ **Self-modifying** - Can edit its own configuration
- ✅ **Local execution** - Runs on your hardware (Mac mini, Raspberry Pi)

**Architecture:**
```
Core Agent (Node.js)
├── Comms adapters (WhatsApp, Telegram, etc.)
├── Skill registry
├── Memory store (persistent)
├── Cron scheduler
├── Heartbeat monitor
└── Sub-agent orchestrator
```

**Configuration:**
- Skills defined in code + metadata
- Persona onboarding flow
- Hot-reload of skills

---

## 2. What We Wanted vs What We Have

### 2.1 Original Requirements (from Hestia docs)

| Feature | Status | Notes |
|---------|--------|-------|
| **Backend** | | |
| Entity-first architecture | ✅ | 4 profiles created |
| Hub Protocol REST API | ✅ | hearth.ts + intelligence.ts |
| Agnostic AI provider | ✅ | 5 provider types |
| **CLI** | | |
| Package management | ✅ | add, remove, status, ignite, extinguish |
| Configuration management | ✅ | YAML config with wizard |
| Installation phases | ✅ | phase1, phase2, phase3 |
| USB creation | ✅ | Ventoy-based |
| **Intelligence Layer** | | |
| Builder agent | ⚠️ | **Use OpenClaude instead** |
| Personal assistant | ⚠️ | **Use OpenClaw instead** |
| A2A bridge | ❌ | Not implemented |
| **Integration** | | |
| OpenClaw connection | ❌ | Not implemented |
| OpenClaude connection | ❌ | Not implemented |
| Synap Backend sync | ✅ | Via Hub Protocol |
| **State Management** | | |
| Normal + Local state | ❌ | Not implemented |
| Auto-config updates | ❌ | Not implemented |
| Environment sync | ❌ | Not implemented |

---

### 2.2 Gap Analysis

#### HIGH PRIORITY GAPS

1. **Builder Agent (OpenClaude integration)**
   - We planned to build our own coding agent
   - **OpenClaude already has this** - 200+ models, tools, MCP, VS Code extension
   - **Gap:** We need to integrate it, not rebuild it

2. **Personal Assistant (OpenClaw integration)**
   - We planned to build proactive AI with comms
   - **OpenClaw already has this** - WhatsApp, Telegram, Discord, skills
   - **Gap:** We need to connect it, not rebuild it

3. **Unified State Management**
   - No current solution for "normal state" vs "local state"
   - Need: Configuration → Environment Variables → Runtime State
   - Need: Bidirectional sync (config changes update env, env changes update config)

4. **A2A (Agent-to-Agent) Bridge**
   - OpenClaude and OpenClaw need to communicate
   - Need: Routing layer, message bus, shared memory

#### MEDIUM PRIORITY GAPS

5. **Auto-Configuration Sync**
   - When user updates hestia config, it should update OpenClaude/OpenClaw configs
   - When packages change state, it should reflect in Synap entities

6. **Unified CLI Experience**
   - Currently: Hestia CLI is separate from OpenClaude/OpenClaw CLIs
   - Need: Single entry point that orchestrates all three

7. **User Onboarding Flow**
   - Need unified "first-fire" that sets up all three components

---

## 3. Integration Architecture

### 3.1 Proposed New Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     HESTIA UNIFIED CLI                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Single Entry Point: `hestia`                               │   │
│  │  ├─ `hestia ai` → OpenClaude                                │   │
│  │  ├─ `hestia assistant` → OpenClaw                          │   │
│  │  ├─ `hestia status` → Hestia Core                          │   │
│  │  └─ `hestia config` → Unified State Manager                │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌───────────────┐ ┌─────────────────┐
│   HESTIA CORE   │ │  OPENCLAUDE   │ │    OPENCLAW     │
│                 │ │               │ │                 │
│ • Package Mgmt  │ │ • Coding Agent│ │ • Personal Asst │
│ • Installation  │ │ • 200+ Models │ │ • Comms (TG/WA) │
│ • Status/Health │ │ • MCP Tools   │ │ • Skills        │
│ • State Manager │ │ • VS Code Ext │ │ • Proactive AI  │
│ • Config Sync   │ │ • gRPC Server │ │ • Memory        │
│                 │ │               │ │                 │
│ Connects via    │ │ Connects via  │ │ Connects via    │
│ Hub Protocol    │ │ gRPC / CLI    │ │ A2A Bridge      │
└─────────────────┘ └───────────────┘ └─────────────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SYNAP BACKEND (Entity Layer)                    │
│                                                                     │
│  • hearth_node (status, config)                                    │
│  • intelligence_provider (AI settings)                             │
│  • package_instance (installed packages)                           │
│  • hearth_deployment (history)                                     │
│  • ai_agent (OpenClaude/OpenClaw state)                            │
│  • user_preferences (cross-system config)                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 3.2 State Management Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     UNIFIED STATE MANAGER                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   NORMAL     │    │    LOCAL     │    │   RUNTIME    │
│    STATE     │    │    STATE     │    │    STATE     │
│              │    │              │    │              │
│ ~/.hestia/   │    │ ~/.openclaude│    │ Environment  │
│ config.yaml  │◄──►│ profile.json │◄──►│ Variables    │
│              │    │              │    │              │
│ Synap        │    │ ~/.openclaw/ │    │ In-Memory    │
│ Entities     │    │ config/      │    │ Cache        │
└──────────────┘    └──────────────┘    └──────────────┘
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SYNC ENGINE (Hestia Core)                       │
│                                                                     │
│  • Config change → Updates all system configs                       │
│  • Synap entity change → Updates local configs                      │
│  • Environment change → Persists to config files                    │
│  • Two-way sync with conflict resolution                            │
│                                                                     │
│  Conflict Rules:                                                    │
│  1. Synap Backend = Source of Truth                                 │
│  2. Local changes are proposals (require approval)                  │
│  3. Environment vars override on restart                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Library Integration Plan

### 4.1 What to Use (Don't Reinvent)

| Feature | Existing Solution | Integration Method |
|---------|------------------|-------------------|
| **Coding Agent** | OpenClaude | npm install + gRPC client |
| **Multi-provider AI** | OpenClaude provider layer | Re-use via OpenClaude |
| **Tools (bash, file, grep)** | OpenClaude tool system | Import as library |
| **MCP Support** | OpenClaude MCP | Re-use |
| **VS Code Extension** | OpenClaude VS Code ext | Bundle together |
| **Personal Assistant** | OpenClaw | npm install + A2A bridge |
| **Comms (Telegram/WhatsApp)** | OpenClaw adapters | Re-use via OpenClaw |
| **Skills System** | OpenClaw skills | Import pattern |
| **Persistent Memory** | OpenClaw memory | Sync to Synap entities |
| **Proactive AI** | OpenClaw cron/heartbeat | Integrate scheduler |
| **Web Search** | OpenClaude DuckDuckGo/Firecrawl | Use via gRPC |

---

### 4.2 What to Build (Unique Value)

| Feature | Why We Build It | Implementation |
|---------|----------------|------------------|
| **Hestia Core** | Orchestration layer | Package manager, installer |
| **State Manager** | Cross-system sync | Bidirectional sync engine |
| **A2A Bridge** | Connect OpenClaude ↔ OpenClaw | Message bus + routing |
| **Entity Bridge** | Synap ↔ Local sync | Hub Protocol extensions |
| **Unified CLI** | Single entry point | Command delegation |
| **USB Installer** | Hardware provisioning | Ventoy + cloud-init |
| **Config Sync** | Auto-update all systems | File watchers + API calls |

---

## 5. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Goal:** Integrate OpenClaude as library dependency

```bash
# Add to hestia-cli packages/core/package.json
{
  "dependencies": {
    "@gitlawb/openclaude": "^0.1.8",
    "@openclaw/core": "^1.0.0"  # If published, else git submodule
  }
}
```

**Tasks:**
1. ✅ Install OpenClaude as dependency
2. ✅ Create `HestiaOpenClaudeService` wrapper
3. ✅ Map Hestia config → OpenClaude config
4. ✅ Add `hestia ai` command (delegates to OpenClaude)
5. ✅ Add `hestia ai:setup` command (configure providers)

---

### Phase 2: State Management (Week 3-4)

**Goal:** Build unified state manager

```typescript
// New file: lib/state-manager.ts
export class UnifiedStateManager {
  // Normal State (Synap Backend)
  async getNormalState(): Promise<HestiaState>
  async setNormalState(state: HestiaState): Promise<void>
  
  // Local State (OpenClaude/OpenClaw configs)
  async getLocalState(): Promise<LocalState>
  async setLocalState(state: LocalState): Promise<void>
  
  // Runtime State (Environment + Memory)
  getRuntimeState(): RuntimeState
  setRuntimeState(state: RuntimeState): void
  
  // Sync engine
  async syncAll(): Promise<SyncReport>
  watchAndSync(): void
}
```

**Tasks:**
1. Create state manager
2. Build sync engine with conflict resolution
3. Add file watchers for config changes
4. Implement two-way Synap sync
5. Add `hestia config:sync` command

---

### Phase 3: OpenClaw Integration (Week 5-6)

**Goal:** Integrate OpenClaw as assistant layer

**Tasks:**
1. Add OpenClaw as dependency (or git submodule)
2. Create `HestiaOpenClawService` wrapper
3. Build A2A bridge (OpenClaude ↔ OpenClaw)
4. Map Hestia config → OpenClaw config
5. Add `hestia assistant` command
6. Add `hestia assistant:skill` command

---

### Phase 4: A2A Bridge (Week 7-8)

**Goal:** Enable agent-to-agent communication

```typescript
// New file: lib/a2a-bridge.ts
export class A2ABridge {
  // Message routing
  route(message: A2AMessage): Promise<void>
  
  // Agent discovery
  discoverAgents(): Promise<AgentInfo[]>
  
  // Shared memory
  getSharedMemory(agentId: string): Promise<Memory>
  setSharedMemory(agentId: string, memory: Memory): Promise<void>
  
  // Event bus
  subscribe(event: string, handler: EventHandler): void
  publish(event: string, payload: any): void
}
```

**Tasks:**
1. Create A2A protocol definitions
2. Build message bus (Redis or in-memory)
3. Implement agent discovery
4. Add shared memory layer
5. Create event system
6. Add `hestia agents` command group

---

### Phase 5: Unified CLI (Week 9-10)

**Goal:** Single CLI that orchestrates everything

```bash
hestia --help
# Hestia - Sovereign AI Infrastructure
#
# Commands:
#   status           Check all systems (Hestia + OpenClaude + OpenClaw)
#   ignite           Start all services
#   extinguish       Stop all services
#
# AI & Coding:
#   ai               Start OpenClaude coding agent
#   ai:configure     Configure AI providers
#   ai:mcp           Manage MCP servers
#
# Personal Assistant:
#   assistant        Start OpenClaw assistant
#   assistant:skill  Manage skills
#   assistant:comm   Configure comms (Telegram/WhatsApp)
#
# Infrastructure:
#   add <package>    Add package to hearth
#   remove <package> Remove package
#   package <cmd>    Package management
#
# Configuration:
#   config           View all configs (unified)
#   config:sync      Sync across all systems
#   config:export    Export configuration
#   config:import    Import configuration
#
# Agents:
#   agents:list      List active agents
#   agents:message   Send message to agent
#   agents:route     Configure agent routing
```

---

## 6. Detailed Component Design

### 6.1 State Manager Implementation

```typescript
// packages/core/src/lib/state-manager.ts

import { getConfig, updateConfig } from './config.js';
import { ApiClient } from './api-client.js';

interface StateLayer {
  normal: HestiaState;      // Synap Backend
  local: LocalState;        // OpenClaude + OpenClaw configs
  runtime: RuntimeState;    // Environment + Memory
}

export class UnifiedStateManager {
  private api: ApiClient;
  private configPath: string;
  private watchers: Map<string, FileWatcher> = new Map();
  
  constructor(api: ApiClient) {
    this.api = api;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // NORMAL STATE (Synap Backend / Hestia Config)
  // ═══════════════════════════════════════════════════════════════
  
  async getNormalState(): Promise<HestiaState> {
    // 1. Get from local config file
    const localConfig = await getConfig();
    
    // 2. Get from Synap Backend entities
    const entities = await this.api.getHearthState(localConfig.hearthId);
    
    // 3. Merge (Synap wins on conflict)
    return mergeStates(localConfig, entities);
  }
  
  async setNormalState(state: HestiaState): Promise<void> {
    // 1. Update local config file
    await updateConfig(state);
    
    // 2. Update Synap Backend entities
    await this.api.updateHearthState(state.hearthId, state);
    
    // 3. Trigger sync to local state
    await this.syncToLocal(state);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // LOCAL STATE (OpenClaude + OpenClaw configs)
  // ═══════════════════════════════════════════════════════════════
  
  async getLocalState(): Promise<LocalState> {
    // Read OpenClaude config
    const openclaudeConfig = await readJson(
      `${process.env.HOME}/.openclaude-profile.json`
    );
    
    // Read OpenClaw config
    const openclawConfig = await readJson(
      `${process.env.HOME}/.openclaw/config.json`
    );
    
    return {
      openclaude: openclaudeConfig,
      openclaw: openclawConfig
    };
  }
  
  async setLocalState(state: LocalState): Promise<void> {
    // Write OpenClaude config
    await writeJson(
      `${process.env.HOME}/.openclaude-profile.json`,
      state.openclaude
    );
    
    // Write OpenClaw config
    await writeJson(
      `${process.env.HOME}/.openclaw/config.json`,
      state.openclaw
    );
    
    // Notify systems to reload
    await this.notifyConfigChange();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // RUNTIME STATE (Environment variables + in-memory)
  // ═══════════════════════════════════════════════════════════════
  
  getRuntimeState(): RuntimeState {
    return {
      environment: { ...process.env },
      memory: globalStateCache,
      processes: runningProcesses
    };
  }
  
  setRuntimeState(state: RuntimeState): void {
    // Update environment variables
    Object.entries(state.environment).forEach(([key, value]) => {
      process.env[key] = value;
    });
    
    // Update in-memory cache
    Object.assign(globalStateCache, state.memory);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SYNC ENGINE
  // ═══════════════════════════════════════════════════════════════
  
  async syncAll(): Promise<SyncReport> {
    const report: SyncReport = {
      changes: [],
      conflicts: [],
      errors: []
    };
    
    try {
      // 1. Normal → Local
      const normalState = await this.getNormalState();
      const localChanges = await this.syncToLocal(normalState);
      report.changes.push(...localChanges);
      
      // 2. Local → Normal (proposals)
      const localState = await this.getLocalState();
      const pendingChanges = await this.detectLocalChanges(localState);
      if (pendingChanges.length > 0) {
        report.proposals = pendingChanges;
      }
      
      // 3. Environment sync
      this.syncEnvironment(normalState);
      
    } catch (error) {
      report.errors.push(error.message);
    }
    
    return report;
  }
  
  watchAndSync(): void {
    // Watch config files for changes
    const configFiles = [
      `${process.env.HOME}/.hestia/config.yaml`,
      `${process.env.HOME}/.openclaude-profile.json`,
      `${process.env.HOME}/.openclaw/config.json`
    ];
    
    configFiles.forEach(file => {
      const watcher = watch(file, async () => {
        console.log(`Config changed: ${file}`);
        await this.syncAll();
      });
      this.watchers.set(file, watcher);
    });
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CONFIGURATION TRANSLATION
  // ═══════════════════════════════════════════════════════════════
  
  private async syncToLocal(hestiaState: HestiaState): Promise<Change[]> {
    const changes: Change[] = [];
    
    // Translate Hestia AI config → OpenClaude config
    if (hestiaState.intelligenceProvider) {
      const openclaudeConfig = translateToOpenClaude(hestiaState);
      await this.writeOpenClaudeConfig(openclaudeConfig);
      changes.push({
        system: 'openclaude',
        action: 'updated',
        keys: ['provider', 'model', 'apiKey']
      });
    }
    
    // Translate Hestia config → OpenClaw config
    if (hestiaState.hearthId) {
      const openclawConfig = translateToOpenClaw(hestiaState);
      await this.writeOpenClawConfig(openclawConfig);
      changes.push({
        system: 'openclaw',
        action: 'updated',
        keys: ['hearthId', 'assistantName']
      });
    }
    
    return changes;
  }
  
  private syncEnvironment(hestiaState: HestiaState): void {
    // Export key values to environment
    if (hestiaState.intelligenceProvider?.apiKey) {
      process.env.INTELLIGENCE_API_KEY = hestiaState.intelligenceProvider.apiKey;
    }
    if (hestiaState.synapBackendUrl) {
      process.env.SYNAP_BACKEND_URL = hestiaState.synapBackendUrl;
    }
    if (hestiaState.hearthId) {
      process.env.HEARTH_ID = hestiaState.hearthId;
    }
  }
}

// Helper functions
function translateToOpenClaude(hestiaState: HestiaState): OpenClaudeConfig {
  const provider = hestiaState.intelligenceProvider;
  
  return {
    provider: provider.providerType,
    base_url: provider.endpointUrl,
    api_key: provider.apiKey,
    model: provider.model,
    // ... other mappings
  };
}

function translateToOpenClaw(hestiaState: HestiaState): OpenClawConfig {
  return {
    hearthId: hestiaState.hearthId,
    assistantName: hestiaState.assistantName || 'Hestia',
    synapBackendUrl: hestiaState.synapBackendUrl,
    // ... other mappings
  };
}
```

---

### 6.2 A2A Bridge Implementation

```typescript
// packages/core/src/lib/a2a-bridge.ts

interface Agent {
  id: string;
  name: string;
  type: 'openclaude' | 'openclaw' | 'custom';
  endpoint: string;
  capabilities: string[];
  status: 'online' | 'offline' | 'busy';
}

interface A2AMessage {
  id: string;
  from: string;
  to: string;
  type: 'request' | 'response' | 'event';
  action: string;
  payload: any;
  timestamp: Date;
  correlationId?: string;
}

export class A2ABridge {
  private agents: Map<string, Agent> = new Map();
  private messageBus: EventEmitter;
  private sharedMemory: Map<string, any> = new Map();
  
  constructor() {
    this.messageBus = new EventEmitter();
    this.setupMessageHandlers();
  }
  
  // Agent registration
  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.messageBus.emit('agent:registered', agent);
    console.log(`Agent registered: ${agent.name} (${agent.id})`);
  }
  
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.messageBus.emit('agent:unregistered', agent);
    }
  }
  
  // Message routing
  async send(message: A2AMessage): Promise<void> {
    const targetAgent = this.agents.get(message.to);
    
    if (!targetAgent) {
      throw new Error(`Agent not found: ${message.to}`);
    }
    
    if (targetAgent.status === 'offline') {
      // Queue for later delivery
      await this.queueMessage(message);
      return;
    }
    
    // Route based on agent type
    switch (targetAgent.type) {
      case 'openclaude':
        await this.sendToOpenClaude(targetAgent, message);
        break;
      case 'openclaw':
        await this.sendToOpenClaw(targetAgent, message);
        break;
      default:
        await this.sendToCustom(targetAgent, message);
    }
    
    this.messageBus.emit('message:sent', message);
  }
  
  async broadcast(message: Omit<A2AMessage, 'to'>): Promise<void> {
    const promises = Array.from(this.agents.values())
      .filter(agent => agent.status === 'online')
      .map(agent => this.send({ ...message, to: agent.id }));
    
    await Promise.all(promises);
  }
  
  // Shared memory
  getMemory(key: string): any {
    return this.sharedMemory.get(key);
  }
  
  setMemory(key: string, value: any): void {
    this.sharedMemory.set(key, value);
    this.messageBus.emit('memory:updated', { key, value });
  }
  
  async queryMemory(query: string): Promise<any[]> {
    // Search shared memory
    const results = [];
    for (const [key, value] of this.sharedMemory.entries()) {
      if (key.includes(query) || JSON.stringify(value).includes(query)) {
        results.push({ key, value });
      }
    }
    return results;
  }
  
  // Event subscriptions
  on(event: string, handler: (data: any) => void): void {
    this.messageBus.on(event, handler);
  }
  
  off(event: string, handler: (data: any) => void): void {
    this.messageBus.off(event, handler);
  }
  
  // Private methods
  private setupMessageHandlers(): void {
    // Handle agent heartbeats
    this.messageBus.on('agent:heartbeat', (data) => {
      const agent = this.agents.get(data.agentId);
      if (agent) {
        agent.status = 'online';
      }
    });
    
    // Handle agent disconnection
    this.messageBus.on('agent:disconnect', (data) => {
      const agent = this.agents.get(data.agentId);
      if (agent) {
        agent.status = 'offline';
      }
    });
  }
  
  private async sendToOpenClaude(agent: Agent, message: A2AMessage): Promise<void> {
    // Use gRPC or CLI to send message
    // OpenClaude has gRPC server mode
  }
  
  private async sendToOpenClaw(agent: Agent, message: A2AMessage): Promise<void> {
    // OpenClaw likely has an API or socket interface
  }
  
  private async queueMessage(message: A2AMessage): Promise<void> {
    // Persist to disk for later delivery
  }
}
```

---

### 6.3 New Commands

```typescript
// packages/core/src/commands/ai.ts
// Integrates with OpenClaude

import { Command } from 'commander';
import { spawn } from 'child_process';
import { logger } from '../lib/logger.js';

export function aiCommand(program: Command): void {
  const ai = program
    .command('ai')
    .description('AI coding assistant (OpenClaude)');
  
  // Start OpenClaude
  ai
    .command('start')
    .description('Start OpenClaude coding agent')
    .option('-m, --model <model>', 'Model to use')
    .option('-p, --provider <provider>', 'Provider (openai, ollama, etc.)')
    .action(async (options) => {
      logger.info('Starting OpenClaude...');
      
      // Pass through to OpenClaude CLI
      const openclaude = spawn('npx', ['@gitlawb/openclaude'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_MODEL: options.model || process.env.INTELLIGENCE_MODEL,
          OPENAI_BASE_URL: process.env.INTELLIGENCE_ENDPOINT,
          OPENAI_API_KEY: process.env.INTELLIGENCE_API_KEY
        }
      });
      
      openclaude.on('exit', (code) => {
        process.exit(code || 0);
      });
    });
  
  // Configure AI providers
  ai
    .command('configure')
    .description('Configure AI providers')
    .action(async () => {
      // Use OpenClaude's /provider command or implement our own
      // based on Hestia's intelligence provider entity
    });
  
  // List MCP servers
  ai
    .command('mcp')
    .description('Manage MCP servers')
    .action(async () => {
      // Delegate to OpenClaude's MCP management
    });
}

// packages/core/src/commands/assistant.ts
// Integrates with OpenClaw

export function assistantCommand(program: Command): void {
  const assistant = program
    .command('assistant')
    .description('Personal AI assistant (OpenClaw)');
  
  // Start OpenClaw
  assistant
    .command('start')
    .description('Start OpenClaw assistant')
    .action(async () => {
      logger.info('Starting OpenClaw...');
      // Start OpenClaw core
    });
  
  // Manage skills
  assistant
    .command('skill')
    .description('Manage assistant skills')
    .argument('<action>', 'add, remove, list, or update')
    .argument('[name]', 'Skill name')
    .action(async (action, name) => {
      // Delegate to OpenClaw skill management
    });
  
  // Configure comms
  assistant
    .command('comm')
    .description('Configure communications (Telegram, WhatsApp)')
    .action(async () => {
      // Setup Telegram/WhatsApp bots
    });
}

// packages/core/src/commands/agents.ts
// A2A bridge management

export function agentsCommand(program: Command): void {
  const agents = program
    .command('agents')
    .description('Manage AI agents and A2A bridge');
  
  agents
    .command('list')
    .description('List all registered agents')
    .action(async () => {
      // Show OpenClaude, OpenClaw, and any custom agents
    });
  
  agents
    .command('send')
    .description('Send message to an agent')
    .requiredOption('-t, --to <agent>', 'Target agent ID')
    .requiredOption('-m, --message <message>', 'Message to send')
    .action(async (options) => {
      // Use A2A bridge to send message
    });
  
  agents
    .command('route')
    .description('Configure agent routing rules')
    .action(async () => {
      // Configure which agents handle which tasks
    });
}
```

---

## 7. User Experience Flow

### 7.1 First-Time Setup

```bash
# User runs install from USB or script
$ hestia init

# Hestia Unified Setup Wizard
═══════════════════════════════════════════════════════════════════
🔥 Welcome to Hestia - Sovereign AI Infrastructure
═══════════════════════════════════════════════════════════════════

This wizard will set up:
  ✓ Hestia Core (package management, infrastructure)
  ✓ OpenClaude (AI coding assistant)
  ✓ OpenClaw (personal AI assistant)

All running on YOUR hardware, with YOUR data.

Step 1/5: Node Configuration
──────────────────────────────────────────────────────────────────
? Hearth name: my-hestia-node
? Installation type: Local (single node)
? Data directory: /opt/hestia

Step 2/5: AI Provider
──────────────────────────────────────────────────────────────────
? AI Provider: Ollama (local, free)
  ✓ Installing Ollama...
  ✓ Downloading llama3.2 model...
? Or use cloud provider: OpenRouter / Anthropic / OpenAI

Step 3/5: OpenClaude Setup
──────────────────────────────────────────────────────────────────
? Enable coding assistant: Yes
  ✓ Configuring OpenClaude...
  ✓ Setting up MCP servers...
  ✓ Installing VS Code extension...

Step 4/5: OpenClaw Setup
──────────────────────────────────────────────────────────────────
? Enable personal assistant: Yes
? Assistant name: Jarvis
? Communication channels:
  ☑ Telegram
  ☐ WhatsApp
  ☐ Discord
  ☐ iMessage (macOS only)
  ✓ Configuring OpenClaw...
  ✓ Setting up skills...

Step 5/5: Review
──────────────────────────────────────────────────────────────────
Configuration Summary:
  Hearth: my-hestia-node
  AI: Ollama (llama3.2)
  Coding: OpenClaude enabled
  Assistant: Jarvis (Telegram)

? Start services now: Yes

Starting services...
  ✓ Synap Backend
  ✓ OpenClaw (Jarvis)
  ✓ OpenClaude
  ✓ A2A Bridge

═══════════════════════════════════════════════════════════════════
🎉 Setup Complete!
═══════════════════════════════════════════════════════════════════

Your AI infrastructure is ready:
  • Chat with Jarvis: Telegram @your_jarvis_bot
  • Code with AI: hestia ai
  • Check status: hestia status
  • Manage all: hestia --help

Documentation: https://docs.hestia.dev
Community: https://community.hestia.dev
```

---

### 7.2 Daily Usage Flow

```bash
# Morning - check everything
$ hestia status

🔥 Hestia Status - my-hestia-node
═══════════════════════════════════════════════════════════════════

Services:
  ✓ Synap Backend     http://localhost:4000     healthy
  ✓ OpenClaude        gRPC://localhost:50051    online
  ✓ OpenClaw (Jarvis) Telegram                online
  ✓ A2A Bridge        active                  2 agents

AI Provider:
  • Ollama (llama3.2)     Local     ✓

Packages:
  ✓ synap-backend     running     3 days uptime
  ✓ postgres          running     3 days uptime
  ✓ openclaw          running     12 hours uptime

──────────────────────────────────────────────────────────────────
Last updated: 2 minutes ago
```

```bash
# Start coding session
$ hestia ai

# OpenClaude starts with Hestia configuration pre-loaded
# All Hestia packages are accessible as MCP tools
# Synap Backend is available for knowledge queries

OpenClaude> /help
Available tools:
  • hestia:status - Check Hestia services
  • hestia:logs <package> - View package logs
  • synap:query <entity> - Query knowledge graph
  • synap:create <type> - Create entity

OpenClaude> create a new React component for user profiles
# Uses Hestia's component templates
# Can access Synap Backend for user schema
# Can deploy to Hestia web server
```

```bash
# Check what assistant has been doing
$ hestia assistant logs

Jarvis activity (last 24 hours):
  08:00 - Morning briefing sent (Telegram)
  09:30 - Checked calendar, no conflicts
  12:00 - Lunch reminder
  14:15 - Email from boss: summarized and replied
  16:00 - Created skill: "Expense tracker"
  18:00 - Evening summary prepared
```

```bash
# Agents communicating
$ hestia agents list

Registered Agents:
  ID            Name       Type         Status   Capabilities
  ─────────────────────────────────────────────────────────────
  openclaude    Claude     coding       online   code, files, bash
  openclaw      Jarvis     assistant    online   comms, schedule, web

$ hestia agents send -t openclaw "Ask openclaude to review today's PRs"

# Jarvis receives message
# Jarvis sends task to OpenClaude via A2A bridge
# OpenClaude performs code review
# OpenClaude sends results back to Jarvis
# Jarvis summarizes and sends to user via Telegram
```

---

## 8. Implementation Checklist

### Week 1-2: OpenClaude Integration
- [ ] Add `@gitlawb/openclaude` as dependency
- [ ] Create `HestiaOpenClaudeService` wrapper
- [ ] Implement config translation layer
- [ ] Add `hestia ai` command
- [ ] Add `hestia ai:configure` command
- [ ] Test end-to-end flow

### Week 3-4: State Manager
- [ ] Create `UnifiedStateManager` class
- [ ] Implement sync engine
- [ ] Add file watchers
- [ ] Add Synap Backend sync
- [ ] Add `hestia config:sync` command
- [ ] Test bidirectional sync

### Week 5-6: OpenClaw Integration
- [ ] Add OpenClaw as dependency/submodule
- [ ] Create `HestiaOpenClawService` wrapper
- [ ] Implement skill management
- [ ] Add `hestia assistant` command
- [ ] Add `hestia assistant:skill` command
- [ ] Test comms integration

### Week 7-8: A2A Bridge
- [ ] Define A2A protocol
- [ ] Create message bus
- [ ] Implement agent discovery
- [ ] Add shared memory
- [ ] Add `hestia agents` commands
- [ ] Test agent-to-agent communication

### Week 9-10: Polish & Testing
- [ ] Unified CLI experience
- [ ] Error handling & recovery
- [ ] Documentation
- [ ] End-to-end testing
- [ ] USB installer update
- [ ] Release preparation

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OpenClaude API changes | Medium | High | Version pinning, wrapper layer |
| OpenClaw not on npm | Medium | Medium | Git submodule, fork, or contribute |
| Config sync conflicts | High | Medium | Clear conflict rules, user approval |
| State inconsistency | Medium | High | Health checks, auto-repair |
| Performance issues | Low | Medium | Lazy loading, caching |
| User confusion | Medium | Medium | Clear docs, guided setup |

---

## 10. Success Metrics

After implementation:
- [ ] Single `hestia init` sets up everything
- [ ] Config changes propagate to all systems within 5 seconds
- [ ] User can chat with assistant within 2 minutes of install
- [ ] User can start coding with AI within 2 minutes of install
- [ ] Agents can communicate seamlessly
- [ ] All state persisted to Synap Backend
- [ ] USB install works end-to-end
- [ ] Zero manual config file editing required

---

## 11. Conclusion

### Don't Reinvent:
- ❌ **Multi-provider AI** → Use OpenClaude
- ❌ **Coding tools** → Use OpenClaude
- ❌ **MCP support** → Use OpenClaude
- ❌ **Personal assistant** → Use OpenClaw
- ❌ **Comms integration** → Use OpenClaw
- ❌ **Skills system** → Use OpenClaw

### Do Build:
- ✅ **Unified orchestration** → Hestia Core
- ✅ **State synchronization** → State Manager
- ✅ **Agent bridge** → A2A Bridge
- ✅ **Entity integration** → Synap Backend connector
- ✅ **Installation/orchestration** → Hestia CLI
- ✅ **Hardware provisioning** → USB Installer

### Value Proposition:
**"Hestia is the sovereign infrastructure that connects, configures, and orchestrates the best open-source AI tools (OpenClaude + OpenClaw) into a unified, entity-first system that you completely own and control."**

---

**Next Action:** Begin Phase 1 - OpenClaude integration as npm dependency.
