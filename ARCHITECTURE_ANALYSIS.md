# Hestia CLI - Architecture Analysis

## Current Architecture (Commit fa00403)

### Structure Overview

```
packages/cli-consolidated/
├── src/
│   ├── commands/              # 22 CLI commands
│   │   ├── ai.ts             # 573 lines - OpenClaude integration
│   │   ├── ai-chat.ts        # 355 lines - AI Chat UI management
│   │   ├── usb.ts            # 1387 lines - USB creation wizard
│   │   ├── install.ts        # 255 lines - Installation phases
│   │   ├── deploy.ts         # Deploy packages
│   │   ├── status.ts         # System status
│   │   ├── health.ts         # Health checks
│   │   └── ... (15 more)
│   ├── lib/
│   │   ├── domains/          # Domain-organized modules
│   │   │   ├── ai/          # AI services
│   │   │   │   ├── index.ts
│   │   │   │   └── lib/
│   │   │   │       ├── ai-chat-service.ts      # 675 lines
│   │   │   │       ├── openclaude-service.ts   # 819 lines
│   │   │   │       └── openclaw-service.ts     # 1082 lines
│   │   │   ├── install/     # Installation logic
│   │   │   ├── provision/   # Provisioning
│   │   │   ├── registry/    # Package registry
│   │   │   ├── services/    # Core services
│   │   │   ├── shared/      # Shared utilities
│   │   │   └── usb/         # USB management
│   │   ├── services/        # Business logic layer
│   │   ├── types/           # Type definitions
│   │   │   ├── index.ts     # 503 lines - Main types
│   │   │   └── extra-types.ts  # 156 lines - Additional types
│   │   └── utils/           # Utilities
│   │       ├── index.ts     # Barrel exports
│   │       ├── logger.ts    # Logging utilities
│   │       ├── spinner.ts   # CLI spinners
│   │       ├── config.ts    # Config management
│   │       └── preflight.ts # Pre-flight checks
│   └── index.ts             # Entry point
├── package.json
├── tsconfig.json
└── tsup.config.ts           # Build configuration
```

---

## Separation of Concerns Analysis

### 🔴 Current Issues

#### 1. Commands Are Too Large

**Problem:** Several commands exceed 500 lines, mixing concerns:

| Command | Lines | Issues |
|---------|-------|--------|
| `usb.ts` | 1,387 | UI logic, device detection, ISO download, Ventoy integration all mixed |
| `ai.ts` | 573 | Command definitions, helper functions, setup logic all together |
| `openclaw-service.ts` | 1,082 | Service logic, YAML parsing, file operations, API calls |
| `openclaude-service.ts` | 819 | Process management, config handling, MCP management |

**Impact:**
- Hard to test individual components
- Difficult to navigate
- High cognitive load
- Code duplication risk

#### 2. Domain Boundaries Are Blurred

**Current:** `src/lib/domains/ai/lib/` contains:
- AI chat service (UI management)
- OpenClaude service (coding assistant)
- OpenClaw service (alternative AI platform)

**Problem:** These are actually **different domains**:
- AI Chat = End-user chat interfaces
- OpenClaude = Developer coding assistant  
- OpenClaw = AI platform/orchestration

#### 3. Type Definitions Scattered

**Current:**
- `src/lib/types/index.ts` - 503 lines
- `src/lib/types/extra-types.ts` - 156 lines
- Types also defined inline in services
- Some types in `src/lib/domains/*/lib/*.ts`

**Problem:** No single source of truth. Types defined in 3+ locations.

#### 4. Service Layer Responsibilities Unclear

**Current structure:**
```
src/lib/
├── domains/ai/lib/          # Services?
├── domains/services/lib/    # Also services?
└── services/                # More services?
```

**Confusion:** Where should a new service go?

#### 5. Utility Functions Mixed

**Current:** `src/lib/utils/index.ts` exports:
- Logger functions
- Spinner functions  
- Config functions
- Credential functions
- File utilities
- Path utilities

**Problem:** Utilities are a grab bag with no categorization.

---

## 🟢 Recommended Architecture (Future)

### Option A: Clean Architecture (Recommended)

```
packages/cli-consolidated/
├── src/
│   ├── presentation/         # CLI layer (Commander)
│   │   ├── commands/        # Thin command handlers
│   │   │   ├── ai/
│   │   │   │   ├── index.ts           # Command registration
│   │   │   │   ├── start.ts           # 50 lines max
│   │   │   │   ├── status.ts
│   │   │   │   ├── configure.ts
│   │   │   │   └── mcp/
│   │   │   │       ├── list.ts
│   │   │   │       ├── add.ts
│   │   │   │       └── remove.ts
│   │   │   ├── usb/
│   │   │   │   ├── index.ts
│   │   │   │   ├── create.ts
│   │   │   │   ├── list-devices.ts
│   │   │   │   └── download-iso.ts
│   │   │   └── ...
│   │   ├── components/      # Reusable UI components
│   │   │   ├── wizard.ts    # Interactive wizard base
│   │   │   ├── table.ts     # Table display
│   │   │   └── progress.ts  # Progress bars
│   │   └── formatters/      # Output formatters
│   │       ├── json.ts
│   │       └── table.ts
│   ├── application/          # Use cases / Application services
│   │   ├── ai/
│   │   │   ├── start-openclaude.ts    # Use case
│   │   │   ├── configure-provider.ts
│   │   │   └── manage-mcp-servers.ts
│   │   ├── usb/
│   │   │   ├── create-bootable-usb.ts
│   │   │   ├── detect-devices.ts
│   │   │   └── download-image.ts
│   │   └── ...
│   ├── domain/               # Domain logic (pure)
│   │   ├── ai/
│   │   │   ├── models/      # Domain models
│   │   │   │   ├── provider.ts
│   │   │   │   ├── mcp-server.ts
│   │   │   │   └── chat-ui.ts
│   │   │   ├── services/    # Domain services
│   │   │   │   ├── openclaude-service.ts
│   │   │   │   └── ai-chat-service.ts
│   │   │   └── repositories/# Repository interfaces
│   │   │       ├── config-repository.ts
│   │   │       └── process-repository.ts
│   │   └── ...
│   ├── infrastructure/       # External concerns
│   │   ├── persistence/
│   │   │   ├── file-config-repository.ts
│   │   │   └── docker-process-repository.ts
│   │   ├── external/
│   │   │   ├── docker-client.ts
│   │   │   ├── usb-device-client.ts
│   │   │   └── http-client.ts
│   │   └── system/
│   │       ├── process-manager.ts
│   │       └── file-system.ts
│   └── shared/               # Shared kernel
│       ├── types/           # All types here
│       │   ├── index.ts
│       │   ├── ai.ts
│       │   ├── usb.ts
│       │   └── config.ts
│       ├── errors/          # Error classes
│       ├── utils/           # Pure utilities
│       └── constants.ts
```

**Benefits:**
- Clear separation of concerns
- Each file < 100 lines
- Easy to test (pure domain logic)
- Easy to navigate
- Dependencies flow inward

**Trade-offs:**
- More files
- More imports
- Learning curve

---

### Option B: Feature-Based (Simpler)

```
packages/cli-consolidated/
├── src/
│   ├── features/             # One folder per feature
│   │   ├── ai/
│   │   │   ├── commands/    # Command handlers
│   │   │   ├── services/    # Business logic
│   │   │   ├── types.ts     # Feature types
│   │   │   └── utils.ts     # Feature utilities
│   │   ├── usb/
│   │   │   ├── commands/
│   │   │   ├── services/
│   │   │   ├── types.ts
│   │   │   └── utils.ts
│   │   ├── install/
│   │   └── ...
│   ├── shared/              # Cross-cutting concerns
│   │   ├── types/          # Common types
│   │   ├── utils/          # Pure utilities
│   │   ├── ui/             # UI components
│   │   └── errors.ts
│   └── index.ts
```

**Benefits:**
- Easier to understand than Clean Architecture
- Related code stays together
- Good for medium-sized projects

**Trade-offs:**
- Less strict separation
- Can still grow large

---

### Option C: Current + Refactored (Incremental)

Keep current structure but refactor the large files:

```
packages/cli-consolidated/
├── src/
│   ├── commands/            # Keep current structure
│   │   └── ai.ts           # But refactor to < 200 lines
│   ├── services/            # Move business logic here
│   │   ├── ai/
│   │   │   ├── openclaude.ts
│   │   │   ├── ai-chat.ts
│   │   │   └── index.ts
│   │   └── usb/
│   │       ├── creator.ts
│   │       ├── detector.ts
│   │       └── downloader.ts
│   ├── types/               # Consolidate all types
│   │   ├── index.ts
│   │   ├── ai.ts           # AI-related types
│   │   ├── usb.ts          # USB-related types
│   │   └── config.ts       # Config types
│   └── utils/               # Organize by category
│       ├── ui/             # UI utilities
│       ├── system/         # System utilities
│       └── config/         # Config utilities
```

**Benefits:**
- Incremental improvement
- Less disruptive
- Maintains familiarity

**Trade-offs:**
- Not as clean as full refactor
- Technical debt remains

---

## Recommendation

### Short Term (Next 2 weeks)

Implement **Option C** - Incremental refactoring:

1. **Extract services from commands:**
   ```typescript
   // Before: usb.ts (1387 lines)
   // After:
   // - commands/usb.ts (150 lines - thin wrapper)
   // - services/usb/creator.ts (400 lines)
   // - services/usb/detector.ts (200 lines)
   // - services/usb/downloader.ts (300 lines)
   // - services/usb/ventoy.ts (337 lines)
   ```

2. **Consolidate types:**
   ```
   types/
   ├── index.ts        # Re-exports
   ├── ai.ts           # All AI types
   ├── usb.ts          # All USB types
   ├── config.ts       # Config types
   └── core.ts         # Core types (Package, Hearth, etc.)
   ```

3. **Organize utils:**
   ```
   utils/
   ├── index.ts        # Re-exports
   ├── ui/
   │   ├── logger.ts
   │   ├── spinner.ts
   │   └── table.ts
   ├── system/
   │   ├── file.ts
   │   └── process.ts
   └── config/
       ├── loader.ts
       └── paths.ts
   ```

### Medium Term (Next 2 months)

Evaluate **Option B** (Feature-Based) if:
- Team grows
- More features added
- Need better isolation

### Long Term (6+ months)

Consider **Option A** (Clean Architecture) if:
- CLI becomes enterprise-grade
- Need extensive testing
- Multiple teams working on it
- Plugin system needed

---

## Package Consolidation

### Current Multi-Package Structure

```
packages/
├── ai/                    # AI types and utilities
├── cli-consolidated/      # Main CLI (this one works!)
├── core/                  # Core types (node_modules issues)
├── types/                 # Shared types
├── usb/                   # USB utilities
└── utils/                 # Shared utilities
```

**Problem:** 
- `cli-consolidated` works
- Other packages have build issues
- Dependencies between packages are messy
- Not clear which package to use for what

### Recommended: Single Package

Consolidate everything into `packages/cli/`:

```
packages/cli/
├── src/
│   ├── features/          # All features
│   ├── shared/            # Shared code
│   └── index.ts
├── package.json           # Single source of truth
├── tsconfig.json
└── README.md
```

**Benefits:**
- One build to maintain
- No inter-package dependencies
- Clear structure
- Easy to install (`npm install -g @hestia/cli`)

**Migration:**
1. Create `packages/cli/` from `cli-consolidated/`
2. Move relevant code from other packages
3. Deprecate old packages
4. Update documentation

---

## Summary

| Aspect | Current | Recommended |
|--------|---------|-------------|
| **Structure** | Domain-based, mixed concerns | Feature-based with clear boundaries |
| **File Size** | Some > 1000 lines | Max 200 lines per file |
| **Type Safety** | Working but messy errors | Clean, no errors |
| **Packages** | 5+ packages, 1 works | 1 consolidated package |
| **Testability** | Hard (large files) | Easy (small units) |
| **Maintainability** | Medium | High |

**Immediate Actions:**
1. ✅ Push current working code (DONE)
2. 🔄 Document TypeScript errors (DONE)
3. 📋 Create refactoring plan (THIS DOC)
4. 🔧 Fix critical type errors (export naming, config types)
5. 📦 Consolidate packages
6. 🏗️ Refactor large files incrementally
