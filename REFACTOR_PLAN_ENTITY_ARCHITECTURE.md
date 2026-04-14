# Refactor Plan: From CLI Tool to Entity Creation System

## Current State vs North Star

### Current Architecture
```
packages/cli-consolidated/
├── src/
│   ├── commands/          # 22 commands, mixed concerns
│   ├── application/       # NEW: Business logic layer
│   ├── lib/
│   │   ├── services/      # Infrastructure
│   │   ├── domains/       # Domain logic
│   │   └── utils/         # Utilities
```

**Problems:**
- Single monolithic package
- Commands mix multiple concerns
- No clear organ separation
- Hard to extend
- No entity state tracking

### Target Architecture
```
packages/
├── eve-cli/            # Orchestrator (thin)
├── @eve/brain/         # Brain organ
├── @eve/arms/          # Arms organ
├── @eve/legs/          # Legs organ
├── @eve/builder/       # Builder organ
├── @eve/eyes/          # Eyes organ
├── @eve/heart/         # Heart organ
├── @eve/dna/           # DNA (config)
└── @eve/usb/           # Birth (USB)
```

**Benefits:**
- Clear organ separation
- Independent versioning
- Selective installation
- Plugin architecture ready
- Entity state tracking

---

## Phase 1: Organ Separation (Week 1-2)

### Step 1.1: Create Package Skeletons

Create 9 new packages in `packages/`:

```bash
# Create organ packages
mkdir -p packages/{brain,arms,legs,builder,eyes,heart,dna,usb}

# Each package structure:
# packages/@eve/<organ>/
# ├── package.json
# ├── tsconfig.json
# ├── src/
# │   ├── index.ts
# │   ├── commands/
# │   ├── lib/
# │   └── types/
# └── README.md
```

### Step 1.2: Extract Brain Package

**Files to move to `@eve/brain`:**
```
From: packages/cli-consolidated/src/
To:   packages/brain/src/

Commands:
- commands/init.ts → brain/src/commands/init.ts
- commands/status.ts → brain/src/commands/status.ts
- commands/config.ts → brain/src/commands/config.ts

Services:
- lib/services/config-service.ts → brain/src/lib/config-service.ts
- lib/domains/services/lib/state-manager.ts → brain/src/lib/state-manager.ts

Utils:
- lib/utils/config.ts → brain/src/lib/config-manager.ts
```

**Brain Package API:**
```typescript
// packages/brain/src/index.ts
export { initBrain } from './commands/init.js'
export { getBrainStatus } from './commands/status.js'
export { ConfigManager } from './lib/config-manager.js'
export type { BrainConfig, BrainState } from './types/index.js'
```

### Step 1.3: Extract Arms Package

**Files to move to `@eve/arms`:**
```
From: packages/cli-consolidated/src/
To:   packages/arms/src/

Commands:
- commands/ai.ts → arms/src/commands/ai.ts
- commands/ai-chat.ts → arms/src/commands/ai-chat.ts

Services:
- lib/domains/ai/lib/openclaude-service.ts → arms/src/lib/openclaude/
- lib/domains/ai/lib/openclaw-service.ts → arms/src/lib/openclaw/
- lib/domains/ai/lib/ai-chat-service.ts → arms/src/lib/ai-chat/
```

**Arms Package API:**
```typescript
// packages/arms/src/index.ts
export { aiCommand } from './commands/ai.js'
export { aiChatCommand } from './commands/ai-chat.js'
export { OpenClaudeService } from './lib/openclaude/index.js'
export { OllamaService } from './lib/ollama/index.js'
export type { AIProvider, AIConfig } from './types/index.js'
```

### Step 1.4: Extract Legs Package

**Files to move to `@eve/legs`:**
```
Commands:
- commands/tunnel.ts → legs/src/commands/tunnel.ts
- commands/proxy.ts → legs/src/commands/proxy.ts

Services:
- lib/services/domain-service.ts → legs/src/lib/domain-service.ts
- lib/services/docker-compose-generator.ts (traefik part) → legs/src/lib/traefik/
```

### Step 1.5: Extract Other Organs

**Builder Package:**
- `commands/deploy.ts` → builder deploy
- Website generation logic
- Doc-ployer functionality

**Eyes Package:**
- RSS server management
- Connectors
- Webhook receivers

**Heart Package:**
- Docker management
- Health checks
- Backup/recovery

**DNA Package:**
- Credential management
- Configuration schemas
- State persistence

**USB Package:**
- `commands/usb.ts`
- USB creation
- OS installation

### Step 1.6: Create CLI Orchestrator

**New Thin CLI:**
```typescript
// packages/eve-cli/src/index.ts
import { Command } from 'commander'
import { initBrain } from '@eve/brain'
import { aiCommand } from '@eve/arms'
import { tunnelCommand } from '@eve/legs'
// ... etc

const program = new Command()

// Register organ commands
initBrain(program)
aiCommand(program)
tunnelCommand(program)
// ... etc

program.parse()
```

---

## Phase 2: Entity State System (Week 3-4)

### Step 2.1: Create Entity State Manager

**New File:** `packages/dna/src/lib/entity-state.ts`

```typescript
export interface EntityState {
  id: string
  phase: EntityPhase
  organs: OrganStates
  capabilities: string[]
  health: HealthStatus
  createdAt: Date
  updatedAt: Date
}

export type EntityPhase = 
  | 'conception'   // USB created
  | 'birth'        // OS installed
  | 'awakening'    // Installing
  | 'alive'        // Core ready
  | 'growing'      // Adding organs
  | 'mature'       // Full entity

export interface OrganStates {
  brain: OrganState
  arms: OrganState
  legs: OrganState
  builder: OrganState
  eyes: OrganState
  heart: OrganState
}

export type OrganState = 
  | 'missing'
  | 'installing'
  | 'ready'
  | 'error'
  | 'degraded'

export class EntityStateManager {
  async getState(): Promise<EntityState>
  async updateOrgan(organ: Organ, state: OrganState): Promise<void>
  async addCapability(capability: string): Promise<void>
  async getNextSteps(): Promise<string[]>
  async calculateCompleteness(): Promise<number>
  async calculateHealth(): Promise<number>
}
```

### Step 2.2: Implement Health Checks per Organ

Each organ package exports health check:

```typescript
// packages/brain/src/lib/health.ts
export async function checkBrainHealth(): Promise<HealthStatus> {
  // Check if Synap backend is responding
  // Check database connectivity
  // Check API endpoints
  return {
    status: 'healthy', // 'healthy' | 'degraded' | 'unhealthy'
    checks: [
      { name: 'api', status: 'pass' },
      { name: 'database', status: 'pass' },
    ],
    message: 'Brain is fully operational'
  }
}
```

### Step 2.3: Create Enhanced Status Command

**New Command:** `eve status` (entity view)

```typescript
// packages/eve-cli/src/commands/status.ts
import { EntityStateManager } from '@eve/dna'

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Show entity status')
    .option('--organs', 'Show organ details')
    .option('--health', 'Show health metrics')
    .action(async (options) => {
      const state = await EntityStateManager.getState()
      
      console.log(`🧠 Entity: ${state.id}`)
      console.log(`📊 Phase: ${state.phase}`)
      console.log(`🏥 Health: ${state.health.overall}%`)
      console.log(`📈 Completeness: ${await calculateCompleteness()}%`)
      
      if (options.organs) {
        printOrganStatus(state.organs)
      }
      
      const nextSteps = await EntityStateManager.getNextSteps()
      if (nextSteps.length > 0) {
        console.log('\n🎯 Next Steps:')
        nextSteps.forEach((step, i) => {
          console.log(`  ${i + 1}. ${step}`)
        })
      }
    })
}
```

### Step 2.4: Create Doctor Command

**New Command:** `eve doctor`

```typescript
// packages/eve-cli/src/commands/doctor.ts
export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose and fix entity issues')
    .option('--fix', 'Auto-fix issues')
    .action(async (options) => {
      const diagnoses = await runDiagnostics()
      
      for (const diag of diagnoses) {
        console.log(`${diag.severity}: ${diag.message}`)
        
        if (options.fix && diag.fixable) {
          console.log(`  → Fixing: ${diag.fixDescription}`)
          await diag.fix()
        } else if (diag.fixable) {
          console.log(`  → Fix: ${diag.fixCommand}`)
        }
      }
    })
}
```

---

## Phase 3: Intelligent CLI (Week 5-6)

### Step 3.1: Context-Aware Suggestions

**New Service:** `packages/dna/src/lib/intelligence.ts`

```typescript
export class CLIIntelligence {
  async suggestNextCommand(): Promise<Suggestion[]> {
    const state = await this.getEntityState()
    const suggestions: Suggestion[] = []
    
    // If no brain, suggest init
    if (state.organs.brain === 'missing') {
      suggestions.push({
        command: 'eve brain init',
        reason: 'Entity needs a brain to function',
        priority: 'critical'
      })
    }
    
    // If brain ready but no arms, suggest AI setup
    if (state.organs.brain === 'ready' && state.organs.arms === 'missing') {
      suggestions.push({
        command: 'eve arms install',
        reason: 'Add AI capabilities to your entity',
        priority: 'high'
      })
    }
    
    // If local only, suggest legs
    if (state.organs.legs === 'missing' && state.age > 7) {
      suggestions.push({
        command: 'eve legs setup',
        reason: 'Your entity has been local for a week. Connect it to the world?',
        priority: 'medium'
      })
    }
    
    return suggestions
  }
}
```

### Step 3.2: Create Grow Command

**New Command:** `eve grow`

```typescript
// packages/eve-cli/src/commands/grow.ts
export function growCommand(program: Command): void {
  program
    .command('grow')
    .description('Intelligently grow your entity')
    .option('--to <target>', 'Target phase', 'mature')
    .action(async (options) => {
      const current = await EntityStateManager.getState()
      const target = options.to
      
      const plan = await GrowthPlanner.createPlan(current, target)
      
      console.log(`📈 Growth Plan: ${current.phase} → ${target}`)
      console.log(`⏱️  Estimated Time: ${plan.estimatedTime}`)
      console.log('\n📋 Steps:')
      
      for (const step of plan.steps) {
        console.log(`  ${step.order}. ${step.description}`)
        console.log(`     Command: ${step.command}`)
      }
      
      const proceed = await confirm('Proceed with growth?')
      if (proceed) {
        for (const step of plan.steps) {
          console.log(`\n▶️  ${step.description}...`)
          await executeCommand(step.command)
        }
        console.log('\n✅ Entity has grown!')
      }
    })
}
```

### Step 3.3: Predictive Error Handling

**New Service:** `packages/dna/src/lib/error-prediction.ts`

```typescript
export class ErrorPredictor {
  async predictIssues(command: string): Promise<Warning[]> {
    const warnings: Warning[] = []
    const state = await EntityStateManager.getState()
    
    // Predict if user is trying to add arms before brain
    if (command.includes('arms') && state.organs.brain === 'missing') {
      warnings.push({
        type: 'dependency_error',
        message: 'Arms need a brain to function',
        suggestion: 'Run "eve brain init" first'
      })
    }
    
    // Predict disk space issues
    if (command.includes('install') || command.includes('deploy')) {
      const space = await checkDiskSpace()
      if (space < 10) {
        warnings.push({
          type: 'resource_warning',
          message: `Low disk space: ${space}GB remaining`,
          suggestion: 'Free up space or use external storage'
        })
      }
    }
    
    return warnings
  }
}
```

---

## Phase 4: Migration & Compatibility (Week 7)

### Step 4.1: Create Legacy Adapter

**File:** `packages/eve-cli/src/legacy-adapter.ts`

```typescript
// Map old commands to new organ commands
export const LEGACY_COMMANDS: Record<string, string> = {
  'eve init': 'eve brain init',
  'eve ai': 'eve arms start',
  'eve ai:chat': 'eve arms chat',
  'eve deploy': 'eve builder deploy',
  'eve tunnel': 'eve legs tunnel',
  'eve usb': 'eve birth create-usb',
}

export function adaptLegacyCommand(argv: string[]): string[] {
  const command = argv.slice(2).join(' ')
  
  for (const [legacy, modern] of Object.entries(LEGACY_COMMANDS)) {
    if (command.startsWith(legacy)) {
      console.log(`⚠️  Legacy command detected: ${legacy}`)
      console.log(`   New command: ${modern}`)
      return argv.map(arg => 
        arg.replace(legacy.split(' ')[1], modern.split(' ')[1])
      )
    }
  }
  
  return argv
}
```

### Step 4.2: Migration Script

**Create:** `scripts/migrate-to-organs.sh`

```bash
#!/bin/bash
# Migrate from cli-consolidated to organ packages

echo "🔄 Migrating to Entity Architecture..."

# Backup current config
cp -r ~/.eve ~/.eve.backup.$(date +%Y%m%d)

# Install new organ packages
npm install -g @eve/brain @eve/arms @eve/legs @eve/builder

# Migrate config
eve dna migrate --from=legacy --to=organs

# Verify migration
eve doctor

echo "✅ Migration complete!"
echo "Run 'eve status' to see your entity."
```

### Step 4.3: Deprecation Warnings

Add to old commands:

```typescript
// In legacy commands
export function legacyCommand(program: Command): void {
  program
    .command('old-command')
    .action(async () => {
      console.warn('⚠️  This command is deprecated.')
      console.warn('   Use: eve organ command')
      console.warn('   See: https://docs.eve.sh/migration')
      
      // Still work for backward compatibility
      await executeLegacyCommand()
    })
}
```

---

## Phase 5: Testing & Documentation (Week 8)

### Step 5.1: Test Each Organ Package

```bash
# Test Brain
cd packages/brain
npm test

# Test Arms
cd packages/arms
npm test

# Test integration
cd packages/eve-cli
npm run test:integration
```

### Step 5.2: Create Documentation

**Files to Create:**
```
docs/
├── architecture/
│   ├── entity-concept.md
│   ├── organs.md
│   └── lifecycle.md
├── guides/
│   ├── creating-entity.md
│   ├── growing-entity.md
│   └── troubleshooting.md
├── reference/
│   ├── brain-api.md
│   ├── arms-api.md
│   └── ...
└── migration/
    └── v1-to-v2.md
```

### Step 5.3: Create Examples

**Examples Directory:**
```
examples/
├── minimal-entity/           # Brain + Arms only
├── full-entity/              # Complete entity
├── existing-server/          # No USB path
└── custom-organ/             # Plugin example
```

---

## Implementation Priority

### Must Have (Week 1-2)
- [ ] Create package skeletons
- [ ] Extract Brain package
- [ ] Extract Arms package
- [ ] Create thin CLI orchestrator
- [ ] Ensure backward compatibility

### Should Have (Week 3-4)
- [ ] Entity state system
- [ ] Health checks per organ
- [ ] Enhanced status command
- [ ] Doctor command

### Nice to Have (Week 5-6)
- [ ] Context-aware suggestions
- [ ] Grow command
- [ ] Predictive error handling
- [ ] Intelligence layer

### Polish (Week 7-8)
- [ ] Full documentation
- [ ] Migration script
- [ ] Test suite
- [ ] Examples

---

## Risk Mitigation

### Risk 1: Breaking Changes
**Mitigation:**
- Maintain legacy commands with deprecation warnings
- Provide migration script
- Keep backward compatibility for 2 major versions

### Risk 2: Package Management Complexity
**Mitigation:**
- Use Lerna or Nx for monorepo management
- Automated versioning
- Clear dependency graph

### Risk 3: User Confusion
**Mitigation:**
- Clear documentation
- Migration guide
- Legacy command adapter
- Gradual transition period

---

## Success Metrics

### Technical Metrics
- [ ] All 22 commands work in new architecture
- [ ] Zero breaking changes for users
- [ ] TypeScript: 0 errors
- [ ] Test coverage: >80%
- [ ] Build time: <30 seconds

### User Experience Metrics
- [ ] `eve status` shows entity view
- [ ] `eve doctor` diagnoses issues
- [ ] `eve grow` suggests improvements
- [ ] Migration completes in <5 minutes

### Adoption Metrics
- [ ] 100% of existing users migrate within 3 months
- [ ] New organ packages downloaded >1000x
- [ ] Plugin ecosystem starts growing

---

## Conclusion

This refactor transforms eve from a **CLI tool** into an **Entity Creation System**.

**Key Changes:**
1. **Organ Architecture** - Clear separation of concerns
2. **Entity State** - Track and visualize entity lifecycle
3. **Intelligence** - Context-aware suggestions and diagnostics
4. **Modularity** - Install only what you need

**Benefits:**
- Easier to understand (body metaphor)
- Easier to extend (add organs)
- Easier to debug (doctor command)
- Easier to customize (selective installation)

**Timeline:** 8 weeks
**Risk:** Low (gradual migration)
**Impact:** High (paradigm shift)

