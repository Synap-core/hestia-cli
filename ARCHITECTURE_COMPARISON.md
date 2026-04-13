# Current vs Target Architecture Comparison

## Executive Summary

| Aspect | Current | Target | Improvement |
|--------|---------|--------|-------------|
| **Architecture** | Monolithic CLI | Organ-based packages | ✅ Better separation |
| **Mental Model** | Commands | Entity with organs | ✅ More intuitive |
| **Extensibility** | Hard | Easy (plugins) | ✅ Plugin ready |
| **State Tracking** | None | Full entity state | ✅ Visibility |
| **Installation** | All-or-nothing | Selective organs | ✅ Flexible |
| **Commands** | 22 mixed | Organ-specific | ✅ Clear purpose |

---

## Current Architecture (Monolithic)

### Package Structure
```
packages/
└── cli-consolidated/          # One big package (1,000+ files)
    ├── src/
    │   ├── commands/          # 22 commands mixed together
    │   │   ├── ai.ts          # AI logic
    │   │   ├── usb.ts         # USB logic
    │   │   ├── deploy.ts      # Deploy logic
    │   │   └── ...            # All mixed!
    │   ├── lib/
    │   │   ├── services/      # Infrastructure
    │   │   ├── domains/       # Domain logic
    │   │   └── utils/         # Utilities
    │   └── index.ts           # Entry point
    └── package.json
```

### Command Examples
```bash
# Mixed concerns - user must know what to run
hestia init              # What does this init?
hestia ai                # Just AI, or more?
hestia deploy            # Deploy what exactly?
hestia usb               # Create USB
hestia install phase1    # Install what?
```

### Problems
1. **No mental model** - Users don't understand the architecture
2. **All-or-nothing** - Can't install just AI, must install everything
3. **Hard to extend** - Adding features requires modifying core
4. **No state visibility** - Don't know what's installed/running
5. **Mixed concerns** - Commands do UI + business logic + infrastructure

---

## Target Architecture (Entity-Based)

### Package Structure
```
packages/
├── hestia-cli/                # Thin orchestrator (~50 files)
│   └── src/
│       ├── index.ts           # Registers organs
│       └── commands/
│           └── status.ts      # Entity status
│
├── @hestia/brain/             # Brain organ (~200 files)
│   ├── src/
│   │   ├── commands/
│   │   │   ├── init.ts        # Initialize brain
│   │   │   └── status.ts      # Brain health
│   │   ├── lib/
│   │   │   └── synap-backend/
│   │   └── index.ts
│   └── package.json
│
├── @hestia/arms/              # Arms organ (~300 files)
│   ├── src/
│   │   ├── commands/
│   │   │   ├── install.ts     # Install AI
│   │   │   ├── start.ts       # Start AI
│   │   │   └── configure.ts   # Configure AI
│   │   ├── lib/
│   │   │   ├── openclaude/
│   │   │   └── ollama/
│   │   └── index.ts
│   └── package.json
│
├── @hestia/legs/              # Legs organ (~150 files)
├── @hestia/builder/           # Builder organ (~200 files)
├── @hestia/eyes/              # Eyes organ (~100 files)
├── @hestia/heart/             # Heart organ (~100 files)
├── @hestia/dna/               # DNA/config (~100 files)
└── @hestia/usb/               # Birth/USB (~150 files)
```

### Command Examples
```bash
# Clear organ-based commands
hestia brain init              # Initialize brain (Synap)
hestia arms install            # Install arms (AI)
hestia legs setup              # Setup legs (network)
hestia builder deploy          # Deploy website
hestia eyes rss add <feed>     # Add RSS feed

# Or use intelligent commands
hestia status                  # See entity status
hestia doctor                  # Diagnose issues
hestia grow                    # Grow entity
```

### Benefits
1. **Clear mental model** - Entity with organs is intuitive
2. **Selective installation** - Install only what you need
3. **Easy to extend** - Add new organs as plugins
4. **Full state visibility** - See what's installed and running
5. **Single responsibility** - Each organ has one purpose

---

## User Experience Comparison

### Scenario 1: First-Time User Wants AI Assistant

**Current Flow:**
```bash
$ hestia --help
# 22 commands, which one to use?

$ hestia init
# What is this initializing?

$ hestia install all
# Installs everything, takes 30 minutes
# User only wanted AI!

$ hestia ai
# Finally works, but with a lot of unused stuff
```

**Target Flow:**
```bash
$ hestia --help
# See organ-based commands
# brain, arms, legs, builder, eyes

$ hestia brain init
# Initialize just the brain

$ hestia arms install
# Install just AI arms
# Takes 5 minutes

$ hestia status
# 🧠 Entity: my-server
# 🧠 Brain: Ready
# 🦾 Arms: Ready
# 🦿 Legs: Missing (optional)
```

---

### Scenario 2: Checking What's Running

**Current:**
```bash
$ hestia status
# Lots of technical details
# Hard to understand what's actually running
```

**Target:**
```bash
$ hestia status

🧠 Entity: my-hearth
📊 Phase: Alive
🏥 Health: 75%

Organs:
  🧠 Brain:    ✅ Ready (Synap v2.1.0)
  🦾 Arms:     ✅ Ready (OpenClaude running)
  🦿 Legs:     ⚠️  Missing (No reverse proxy)
  🏗️ Builder:  ❌ Missing
  👁️ Eyes:     ❌ Missing

Capabilities:
  ✅ AI Coding Assistant
  ✅ Data Persistence
  ⚠️  Local Network Only
  ❌ Public Website
  ❌ RSS Aggregation

Next Steps:
  1. hestia legs setup    → Enable public access
  2. hestia builder init  → Create website
```

---

### Scenario 3: Something is Broken

**Current:**
```bash
$ hestia ai
# Error: Connection refused
# User has no idea what's wrong
# Must check logs, config, etc.
```

**Target:**
```bash
$ hestia doctor

🔍 Entity Health Check

Diagnosis:
  ✅ Brain: Healthy
  ⚠️  Arms: OpenClaude not responding
      └─ Cause: Port 3000 already in use
      └─ Fix: Change port or kill process
  ❌ Legs: Traefik not running
      └─ Cause: Docker container stopped
      └─ Fix: Run "hestia heart restart"

Prescription:
  1. kill -9 $(lsof -t -i:3000)
  2. hestia arms restart
  3. hestia heart restart

Run with --fix to auto-fix? [Y/n]: Y
🔧 Fixed! Arms are now ready.
```

---

## Technical Comparison

### Dependency Graph

**Current:**
```
cli-consolidated
├── commands/ai.ts ─────────────────┐
│   ├── services/openclaude.ts      │
│   ├── services/ai-chat.ts         │ Tight coupling
│   └── utils/config.ts             │
├── commands/usb.ts                 │
│   ├── services/usb-generator.ts   │ Everything depends
│   └── utils/config.ts             │ on everything
├── commands/deploy.ts              │
│   ├── services/docker-compose.ts  │
│   └── utils/config.ts ────────────┘
```

**Target:**
```
hestia-cli (orchestrator)
├── @hestia/brain (peer dependency)
├── @hestia/arms (optional)
├── @hestia/legs (optional)
├── @hestia/builder (optional)
└── @hestia/dna (shared)

@hestia/arms
├── Commands: install, start, stop
├── Lib: openclaude/, ollama/
└── Depends on: @hestia/dna, @hestia/brain

@hestia/legs
├── Commands: setup, tunnel
├── Lib: traefik/, cloudflare/
└── Depends on: @hestia/dna

# Clear boundaries, explicit dependencies
```

### State Management

**Current:**
```typescript
// No unified state
// Each command checks its own things
// No visibility into overall system
```

**Target:**
```typescript
// Entity state machine
interface EntityState {
  phase: 'conception' | 'birth' | 'alive' | 'mature'
  organs: {
    brain: 'missing' | 'ready' | 'error'
    arms: 'missing' | 'ready' | 'error'
    legs: 'missing' | 'ready' | 'error'
  }
  capabilities: string[]
  health: number
}

// Centralized state manager
EntityStateManager.getState()
EntityStateManager.updateOrgan('arms', 'ready')
```

---

## Installation Size Comparison

### Current: All-or-Nothing
```bash
npm install -g @hestia/cli
# Downloads: 1,000+ files
# Installs: Everything
# Size: ~50 MB
# Time: 2 minutes
```

### Target: Selective Installation
```bash
# Minimal entity (AI only)
npm install -g @hestia/cli @hestia/brain @hestia/arms
# Downloads: ~300 files
# Installs: Only brain + arms
# Size: ~15 MB
# Time: 30 seconds

# Add more organs as needed
npm install -g @hestia/legs @hestia/builder
```

---

## Extension Comparison

### Current: Hard to Extend
```typescript
// Must modify cli-consolidated
// Add command to commands/
// Register in index.ts
// Rebuild entire package
// Submit PR to core repo
```

### Target: Easy to Extend
```typescript
// Create new package
mkdir packages/@hestia/wings

// Implement organ
export function wingsCommand(program: Command): void {
  program.command('wings').action(...)
}

// Register in hestia-cli
import { wingsCommand } from '@hestia/wings'
wingsCommand(program)

// Publish independently
npm publish packages/@hestia/wings
```

---

## Migration Path

### Phase 1: Dual Mode (Month 1-2)
```bash
# Old commands still work
hestia ai                    # Works (legacy)
hestia arms start            # Works (new)

# Deprecation warning
$ hestia ai
⚠️  Deprecated: Use "hestia arms start"
▶️  Running anyway...
```

### Phase 2: Migration Tool (Month 3)
```bash
$ hestia migrate
🔄 Migrating to Entity Architecture...
✅ Config migrated
✅ Commands updated
📖 See: https://docs.hestia.sh/migration
```

### Phase 3: Legacy Removal (Month 6+)
```bash
# Old commands removed
$ hestia ai
❌ Error: Command removed
   Use: hestia arms start
   See: hestia --help
```

---

## Summary

| Question | Current | Target |
|----------|---------|--------|
| What am I building? | Unclear | A digital entity |
| How do I add AI? | `hestia ai` | `hestia arms install` |
| What's running? | Check logs | `hestia status` |
| Something broke? | Debug manually | `hestia doctor` |
| Can I add features? | Modify core | Install organ packages |
| Do I need everything? | Yes | No, selective install |

**Bottom Line:** The Entity Architecture transforms Hestia from a complex CLI tool into an intuitive system for creating and managing sovereign digital beings.

