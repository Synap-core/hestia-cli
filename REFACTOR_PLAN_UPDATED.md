# Updated Refactor Plan - Focused on AI-First Path

## Clarified Architecture

Based on user feedback, the architecture is now clear:

### Standard Stack (ONE Path to Focus On)

| Organ | Primary Implementation | Purpose |
|-------|------------------------|---------|
| **Brain** | Synap Backend + Ollama | Core intelligence + local AI model |
| **Arms** | OpenClaw | AI coding assistant (connects to Ollama) |
| **Builder** | OpenCode | Website/doc generation |
| **Docploy** | Integrated | Deploy docs between builder and legs |
| **Eyes** | RSSHub | RSS aggregation |
| **Legs** | Traefik | Reverse proxy and exposure |
| **DNA** | Config/Credentials | Identity and secrets |

### Key Clarifications

1. **Ollama is part of Brain** - Local AI model engine
2. **OpenClaw is Arms** - Uses Brain's Ollama for inference
3. **OpenCode is Builder** - Creates websites/docs
4. **Docploy bridges** Builder → Legs
5. **RSSHub is Eyes** - Consumes external knowledge
6. **Focus on ONE path** - Reduce complexity

---

## Current State vs Target

### Current (Monolithic)
```
packages/cli-consolidated/
├── src/
│   ├── commands/
│   │   ├── ai.ts          # Mixes AI model + services
│   │   ├── usb.ts         # USB creation
│   │   ├── deploy.ts      # Deployment
│   │   └── ...
│   └── lib/
│       ├── services/
│       ├── domains/
│       └── utils/
```

**Problems:**
- Commands mix UI + business logic
- No clear organ separation
- No entity state tracking
- Ollama/OpenClaw/OpenCode conflated

### Target (Organ-Based, Focused)
```
packages/
├── hestia-cli/              # Thin orchestrator
│   └── src/
│       ├── index.ts
│       └── commands/
│           ├── entity.ts    # entity status, doctor, grow
│           └── legacy.ts    # backward compatibility
│
├── @hestia/brain/           # Synap + Ollama
│   └── src/
│       ├── commands/init.ts
│       ├── lib/
│       │   ├── synap.ts
│       │   └── ollama.ts    # AI model management
│       └── index.ts
│
├── @hestia/arms/            # OpenClaw
│   └── src/
│       ├── commands/install.ts
│       ├── lib/openclaw.ts
│       └── index.ts
│
├── @hestia/builder/         # OpenCode
│   └── src/
│       ├── commands/init.ts
│       ├── lib/opencode.ts
│       └── index.ts
│
├── @hestia/docploy/         # Doc deployment
│   └── src/
│       ├── commands/deploy.ts
│       └── index.ts
│
├── @hestia/eyes/            # RSSHub
│   └── src/
│       ├── commands/install.ts
│       ├── lib/rsshub.ts
│       └── index.ts
│
├── @hestia/legs/            # Traefik
│   └── src/
│       ├── commands/setup.ts
│       ├── lib/traefik.ts
│       └── index.ts
│
└── @hestia/dna/             # Config + State
    └── src/
        ├── lib/config.ts
        ├── lib/credentials.ts
        ├── lib/entity-state.ts
        └── index.ts
```

---

## Phase 1: Foundation (Week 1)

### Step 1.1: Create Package Structure

Create 8 packages in `packages/`:

```bash
# Create organ packages
for pkg in brain arms builder docploy eyes legs dna; do
  mkdir -p packages/@hestia/$pkg/src/{commands,lib}
  touch packages/@hestia/$pkg/package.json
  touch packages/@hestia/$pkg/tsconfig.json
  touch packages/@hestia/$pkg/src/index.ts
done

# Create thin CLI
mkdir -p packages/hestia-cli/src/commands
touch packages/hestia-cli/src/index.ts
```

### Step 1.2: DNA Package (Config + State)

**Files:**
```typescript
// packages/@hestia/dna/src/lib/entity-state.ts
export interface EntityState {
  id: string
  name: string
  phase: 'conception' | 'birth' | 'awake' | 'mature'
  organs: {
    brain: OrganState
    arms: OrganState
    builder: OrganState
    eyes: OrganState
    legs: OrganState
  }
  ai: {
    model: 'ollama' | 'none'
    modelStatus: 'missing' | 'downloading' | 'ready'
  }
}

export type OrganState = 
  | 'missing'      // Not installed
  | 'installing'   // In progress
  | 'ready'        // Running
  | 'error'        // Broken
  | 'stopped'      // Installed but stopped

export class EntityStateManager {
  async getState(): Promise<EntityState>
  async updateOrgan(organ: Organ, state: OrganState): Promise<void>
  async setAIModel(model: 'ollama' | 'none'): Promise<void>
  async getNextSteps(): Promise<string[]>
}
```

### Step 1.3: Brain Package (Synap + Ollama)

**Key distinction:** Brain includes Ollama for local AI

```typescript
// packages/@hestia/brain/src/lib/ollama.ts
export class OllamaService {
  async install(): Promise<void>
  async pullModel(model: string): Promise<void>
  async isRunning(): Promise<boolean>
  async getStatus(): Promise<AIModelStatus>
}

// packages/@hestia/brain/src/lib/synap.ts  
export class SynapService {
  async install(): Promise<void>
  async start(): Promise<void>
  async isHealthy(): Promise<boolean>
}

// packages/@hestia/brain/src/commands/init.ts
export function initCommand(program: Command): void {
  program
    .command('brain init')
    .option('--with-ai', 'Install Ollama for local AI')
    .option('--model <model>', 'Default: llama3.1:8b')
    .action(async (options) => {
      // Install Synap
      await synapService.install()
      
      // Optionally install Ollama
      if (options.withAi) {
        await ollamaService.install()
        await ollamaService.pullModel(options.model || 'llama3.1:8b')
      }
      
      // Update entity state
      await entityStateManager.updateOrgan('brain', 'ready')
      if (options.withAi) {
        await entityStateManager.setAIModel('ollama')
      }
    })
}
```

### Step 1.4: Arms Package (OpenClaw)

```typescript
// packages/@hestia/arms/src/lib/openclaw.ts
export class OpenClawService {
  async install(): Promise<void>
  async configure(ollamaUrl: string): Promise<void>
  async start(): Promise<void>
  async installMCPServer(name: string): Promise<void>
}

// packages/@hestia/arms/src/commands/install.ts
export function installCommand(program: Command): void {
  program
    .command('arms install')
    .description('Install OpenClaw AI assistant')
    .action(async () => {
      // Check prerequisites
      const state = await entityStateManager.getState()
      
      if (state.organs.brain !== 'ready') {
        throw new Error('Brain not ready. Run: hestia brain init --with-ai')
      }
      
      if (state.ai.model !== 'ollama') {
        throw new Error('Ollama not installed. Run: hestia brain init --with-ai')
      }
      
      // Install OpenClaw
      await openClawService.install()
      await openClawService.configure('http://localhost:11434')
      await openClawService.start()
      
      // Update state
      await entityStateManager.updateOrgan('arms', 'ready')
      
      console.log('🦾 Arms installed! OpenClaw is ready.')
      console.log('   Access: http://localhost:3001')
    })
}
```

---

## Phase 2: Entity Commands (Week 2)

### Step 2.1: Entity Status Command

```typescript
// packages/hestia-cli/src/commands/status.ts
export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Show entity status')
    .action(async () => {
      const state = await entityStateManager.getState()
      
      console.log(`🧠 Entity: ${state.name}`)
      console.log(`📊 Phase: ${state.phase}`)
      console.log(``)
      console.log(`Organs:`)
      console.log(`  🧠 Brain:   ${formatStatus(state.organs.brain)}`)
      if (state.ai.model === 'ollama') {
        console.log(`     └─ Ollama: ${formatStatus(state.ai.modelStatus)}`)
      }
      console.log(`  🦾 Arms:    ${formatStatus(state.organs.arms)}`)
      console.log(`  🏗️ Builder: ${formatStatus(state.organs.builder)}`)
      console.log(`  👁️ Eyes:    ${formatStatus(state.organs.eyes)}`)
      console.log(`  🦿 Legs:    ${formatStatus(state.organs.legs)}`)
      
      const nextSteps = await entityStateManager.getNextSteps()
      if (nextSteps.length > 0) {
        console.log(``)
        console.log(`Next steps:`)
        nextSteps.forEach((step, i) => {
          console.log(`  ${i + 1}. ${step}`)
        })
      }
    })
}

function formatStatus(status: OrganState): string {
  const icons = {
    missing: '❌ Missing',
    installing: '⏳ Installing',
    ready: '✅ Ready',
    error: '🔴 Error',
    stopped: '⏹️  Stopped'
  }
  return icons[status]
}
```

### Step 2.2: Doctor Command

```typescript
// packages/hestia-cli/src/commands/doctor.ts
export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose entity issues')
    .option('--fix', 'Auto-fix issues')
    .action(async (options) => {
      const issues = await diagnose()
      
      for (const issue of issues) {
        console.log(`${issue.severity}: ${issue.message}`)
        
        if (options.fix && issue.fixable) {
          console.log(`  🔧 Fixing...`)
          await issue.fix()
        } else if (issue.fixCommand) {
          console.log(`  💡 Run: ${issue.fixCommand}`)
        }
      }
    })
}
```

---

## Phase 3: Remaining Organs (Week 3-4)

### Step 3.1: Builder Package (OpenCode)

```typescript
// packages/@hestia/builder/src/lib/opencode.ts
export class OpenCodeService {
  async install(): Promise<void>
  async initProject(name: string): Promise<void>
  async generate(): Promise<void>
}

// packages/@hestia/builder/src/commands/init.ts
export function initCommand(program: Command): void {
  program
    .command('builder init')
    .argument('<name>', 'Project name')
    .action(async (name) => {
      await openCodeService.install()
      await openCodeService.initProject(name)
      await entityStateManager.updateOrgan('builder', 'ready')
    })
}
```

### Step 3.2: Docploy Package

```typescript
// packages/@hestia/docploy/src/commands/deploy.ts
export function deployCommand(program: Command): void {
  program
    .command('builder deploy')
    .description('Deploy website/documentation')
    .action(async () => {
      // Build
      await openCodeService.generate()
      
      // Deploy
      await docployService.deploy()
      
      // Expose via legs if ready
      const state = await entityStateManager.getState()
      if (state.organs.legs === 'ready') {
        await traefikService.addRoute('/docs', builderUrl)
      }
    })
}
```

### Step 3.3: Eyes Package (RSSHub)

```typescript
// packages/@hestia/eyes/src/lib/rsshub.ts
export class RSSHubService {
  async install(): Promise<void>
  async addFeed(url: string): Promise<void>
  async syncToBrain(): Promise<void>
}

// packages/@hestia/eyes/src/commands/install.ts
export function installCommand(program: Command): void {
  program
    .command('eyes install')
    .description('Install RSSHub for content consumption')
    .action(async () => {
      await rsshubService.install()
      await entityStateManager.updateOrgan('eyes', 'ready')
    })
}
```

### Step 3.4: Legs Package (Traefik)

```typescript
// packages/@hestia/legs/src/lib/traefik.ts
export class TraefikService {
  async setup(): Promise<void>
  async addRoute(path: string, target: string): Promise<void>
  async enableSSL(domain: string): Promise<void>
}

// packages/@hestia/legs/src/commands/setup.ts
export function setupCommand(program: Command): void {
  program
    .command('legs setup')
    .option('--domain <domain>', 'Custom domain')
    .action(async (options) => {
      await traefikService.setup()
      
      if (options.domain) {
        await traefikService.enableSSL(options.domain)
      }
      
      await entityStateManager.updateOrgan('legs', 'ready')
    })
}
```

---

## Phase 4: Intelligent Commands (Week 5)

### Step 4.1: Grow Command

```typescript
// packages/hestia-cli/src/commands/grow.ts
export function growCommand(program: Command): void {
  program
    .command('grow')
    .description('Intelligently grow your entity')
    .action(async () => {
      const state = await entityStateManager.getState()
      const plan = await GrowthPlanner.createPlan(state)
      
      console.log(`📈 Growth Plan: ${state.phase} → mature`)
      console.log('')
      console.log('Steps:')
      plan.steps.forEach((step, i) => {
        console.log(`  ${i + 1}. ${step.description}`)
        console.log(`     Command: ${step.command}`)
      })
      
      // Execute
      for (const step of plan.steps) {
        console.log(`\n▶️  ${step.description}...`)
        await exec(step.command)
      }
      
      console.log('\n✅ Entity has grown!')
    })
}
```

---

## Phase 5: Migration (Week 6)

### Step 5.1: Legacy Command Mapping

```typescript
// packages/hestia-cli/src/legacy-mapping.ts
export const LEGACY_COMMANDS: Record<string, string> = {
  'hestia init': 'hestia brain init',
  'hestia ai': 'hestia arms start',
  'hestia ai:setup': 'hestia arms install',
  'hestia ai:chat': 'hestia arms chat',
  'hestia deploy': 'hestia builder deploy',
  'hestia tunnel': 'hestia legs setup',
  'hestia usb': 'hestia birth create',
  'hestia install phase1': 'hestia birth phase1',
  'hestia install phase2': 'hestia birth phase2',
  'hestia install phase3': 'hestia birth phase3',
}

// Deprecation warnings
export function handleLegacyCommand(argv: string[]): string[] {
  const command = argv.slice(2).join(' ')
  
  for (const [legacy, modern] of Object.entries(LEGACY_COMMANDS)) {
    if (command.startsWith(legacy)) {
      console.warn(`⚠️  Deprecated: "${legacy}"`)
      console.warn(`   Use: "${modern}"`)
      
      // Transform command
      return argv.map(arg => 
        arg.replace(legacy.split(' ')[1], modern.split(' ')[1])
      )
    }
  }
  
  return argv
}
```

---

## Summary

### New Command Structure

| Old Command | New Command | Description |
|-------------|-------------|-------------|
| `hestia init` | `hestia brain init` | Initialize core |
| `hestia ai` | `hestia arms start` | Start AI assistant |
| `hestia ai:setup` | `hestia arms install` | Install arms |
| `hestia deploy` | `hestia builder deploy` | Deploy website |
| `hestia tunnel` | `hestia legs setup` | Setup exposure |
| `hestia usb` | `hestia birth create` | Create USB |
| `hestia install` | `hestia birth phase*` | Install phases |
| - | `hestia status` | Entity status |
| - | `hestia doctor` | Diagnose issues |
| - | `hestia grow` | Intelligent growth |

### Organ Dependencies

```
Brain (required for all)
  └─ Ollama (optional, for AI)

Arms (requires Brain + Ollama)
  └─ OpenClaw connects to Ollama

Builder (requires Brain)
  └─ OpenCode uses Brain API

Docploy (requires Builder)
  └─ Deploys builder output

Eyes (requires Brain)
  └─ RSSHub feeds into Brain

Legs (optional, exposes all)
  └─ Traefik routes to all organs
```

### Timeline: 6 Weeks

- **Week 1:** Package structure, DNA, Brain
- **Week 2:** Entity commands (status, doctor)
- **Week 3:** Arms, Builder
- **Week 4:** Docploy, Eyes, Legs
- **Week 5:** Intelligent commands
- **Week 6:** Migration, testing, docs

### Next Steps

1. Review this plan
2. Approve standard stack (Synap+Ollama/OpenClaw/OpenCode/RSSHub/Traefik)
3. Start Phase 1 implementation
4. Test each organ independently
5. Integration testing

**Focus:** ONE path, interchangeable parts later.

