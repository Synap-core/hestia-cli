# Hestia CLI - Architecture Analysis Report

## Executive Summary

**Overall Assessment:** The Hestia CLI has a **solid foundation** with good separation of concerns, but has several **architectural inconsistencies** and **coupling issues** that should be addressed for long-term maintainability.

**Strengths:**
- ✅ Clear command structure with Commander.js
- ✅ Centralized configuration management
- ✅ Secure credential storage (YAML with 0600 permissions)
- ✅ State management with bi-directional sync
- ✅ Modular service architecture

**Weaknesses:**
- ⚠️ Tight coupling between domains
- ⚠️ Inconsistent error handling
- ⚠️ Mixed concerns in large command files
- ⚠️ Service stub/re-export pattern is confusing
- ⚠️ StateManager is overly complex

---

## 1. CLI Entry Flow & Architecture

### 1.1 Entry Point Flow

```
index.ts (Entry)
├── Commander Program Setup
│   ├── Global options (--debug, --quiet, --config)
│   ├── Error handlers (unhandledRejection, uncaughtException)
│   └── 22 Command registrations
└── Command Execution
    └── [command].ts
        ├── Parse arguments/options
        ├── Call services
        └── Handle errors
```

**Current Implementation:**
```typescript
// src/index.ts - Lines 46-85
const program = new Command()
program
  .name('hestia')
  .version(packageJson.version)
  .option('-d, --debug', 'Enable debug logging')
  // ... global options

// Register all commands
initCommand(program)
statusCommand(program)
// ... 20 more
```

**Assessment:** ✅ **Good** - Standard Commander.js pattern, clean registration

### 1.2 Command Structure Pattern

Each command follows this pattern:
```typescript
export function commandName(program: Command): void {
  program
    .command('name')
    .description('Description')
    .option('-f, --flag', 'Flag description')
    .action(async (options) => {
      try {
        // Command logic
        await executeCommand(options)
      } catch (error) {
        logger.error(`Failed: ${error.message}`)
        process.exit(1)
      }
    })
}
```

**Issue:** ❌ **Inconsistent error handling** - Some commands exit(1), some don't

---

## 2. Separation of Concerns Analysis

### 2.1 Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                       │
│  (Commander commands: init, status, deploy, ai, usb, etc.)  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Application Layer                          │
│  (Use cases: Install phases, Deploy phases, USB creation)   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Domain Layer                              │
│  (Services: AI services, USB services, State management)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                Infrastructure Layer                         │
│  (Utils: Config, Credentials, Docker, Filesystem)           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Current Separation Assessment

| Layer | Files | Assessment | Issues |
|-------|-------|------------|--------|
| **Presentation** | `src/commands/*.ts` | ⚠️ **Mixed** | Commands mix UI logic with business logic |
| **Application** | Embedded in commands | ❌ **Weak** | No dedicated use case layer |
| **Domain** | `src/lib/domains/*/lib/*.ts` | ✅ **Good** | Well-separated by domain |
| **Infrastructure** | `src/lib/utils/*.ts`, `src/lib/services/*.ts` | ✅ **Good** | Clear utility separation |

### 2.3 Critical Issue: Command Bloat

**Problem:** Commands contain both presentation AND application logic

**Example - `usb.ts` (1,387 lines):**
```typescript
// Lines 42-49: Presentation (command definition)
export function usbCommand(program: Command): void {
  program.command('usb').action(async () => {
    await runInteractiveWizard();  // Business logic
  });
}

// Lines 200-400: Business logic mixed with UI
async function createUSB(options: USBCreateOptions) {
  // Device detection logic
  // Progress display
  // ISO download logic
  // File writing logic
  // All in one function!
}
```

**Recommendation:** Extract business logic to application services:
```typescript
// src/application/usb/create-bootable-usb.ts
export async function createBootableUSB(
  device: USBDevice, 
  config: USBConfig,
  progress: ProgressReporter
): Promise<void> {
  // Pure business logic, no UI
}

// src/commands/usb.ts
.action(async (options) => {
  const progress = createProgressUI();  // UI
  await createBootableUSB(device, config, progress);  // Business logic
})
```

---

## 3. Configuration Management Flow

### 3.1 Configuration Architecture

```
HestiaConfig (Type)
├── version: string
├── hearth: { id, name, role, domain, reverseProxy }
├── packages: Record<string, PackageConfig>
├── intelligence?: IntelligenceConfig
├── dbViewer?: DBViewerConfig
├── tunnel?: TunnelConfig
├── aiChat?: AIChatConfig
├── optionalServices?: Record<string, OptionalServiceConfig>
├── _packagesDir?: string       # Internal
└── _configDir?: string         # Internal
```

### 3.2 Configuration Flow

```
User Input → Zod Validation → HestiaConfig → YAML File
                      ↓
               StateManager
                      ↓
              ┌──────┴──────┐
              ▼              ▼
        Synap Backend    OpenClaude Profile
        (via API)        (local file)
```

**Implementation Quality:** ✅ **Good**

1. **Validation:** Zod schemas ensure type safety
2. **Storage:** YAML files with proper permissions
3. **Sync:** Bidirectional sync via StateManager
4. **Defaults:** Sensible defaults for all optional fields

### 3.3 Credential Management

**Flow:**
```typescript
// Credentials stored separately from config
~/.hestia/
├── config.yaml          # Non-sensitive config
└── credentials.yaml     # Sensitive data (mode 0600)
```

**Functions:**
- `loadCredentials()` - Load from secure file
- `saveCredentials()` - Save with 0600 permissions
- `getCredential(key)` - Get single credential
- `setCredential(key, value)` - Set single credential

**Assessment:** ✅ **Excellent** - Proper separation of sensitive data

---

## 4. USB & OS Handling

### 4.1 USB Creation Flow

```
hestia usb
    ↓
Interactive Wizard (inquirer)
    ↓
┌─────────────────┬─────────────────┬─────────────────┐
│  List Devices   │  Download ISO   │  Create USB     │
│  usb:list       │  usb:download   │  usb:create     │
└─────────────────┴─────────────────┴─────────────────┘
    ↓
USBGenerator Service
    ↓
┌─────────────────┬─────────────────┐
│  Device Check   │  Write Image    │
│  (block device) │  (dd or similar)│
└─────────────────┴─────────────────┘
```

### 4.2 Separation Assessment

**Current Issues:**
1. ❌ USB command mixes device detection, ISO download, and writing
2. ❌ No abstraction for different OS types (Ubuntu, Debian, custom)
3. ❌ No plugin system for different USB creation methods

**Recommended Structure:**
```
src/domains/usb/
├── commands/
│   └── usb-command.ts          # Thin command wrapper
├── application/
│   ├── detect-devices.ts       # Device detection use case
│   ├── download-iso.ts         # ISO download use case
│   └── create-bootable-usb.ts  # USB creation use case
├── domain/
│   ├── usb-device.ts           # Device entity
│   ├── iso-image.ts            # ISO entity
│   └── usb-creator.ts          # Creator service interface
└── infrastructure/
    ├── linux-device-detector.ts
    ├── ubuntu-downloader.ts
    └── dd-image-writer.ts
```

---

## 5. Optionality of Features

### 5.1 Optional Feature Architecture

Features are controlled via configuration:

```typescript
// All features are opt-in via config
interface HestiaConfig {
  intelligence?: IntelligenceConfig      // AI (optional)
  dbViewer?: DBViewerConfig              // DB viewer (optional)
  tunnel?: TunnelConfig                  // Tunnel (optional)
  aiChat?: AIChatConfig                  // Chat UI (optional)
  optionalServices?: Record<string, ...> // Other services
}
```

### 5.2 Feature Toggle Implementation

**In Docker Compose Generator:**
```typescript
// src/lib/services/docker-compose-generator.ts
if (options.provider === 'opencode' || options.provider === 'both') {
  compose.services = { ...compose.services, ...generateOpenCode(options) }
}

if (options.provider === 'openclaude' || options.provider === 'both') {
  compose.services = { ...compose.services, ...generateOpenClaw(options) }
}
```

**Assessment:** ✅ **Good** - Clean conditional service generation

### 5.3 AI Provider Optionality

**Supported Providers:**
- `ollama` - Local, free
- `openrouter` - Multiple models
- `anthropic` - Claude
- `openai` - GPT
- `custom` - Custom endpoint

**Flow:**
```
User Selection → ProviderConfig → Docker Compose / OpenClaude Profile
```

**Assessment:** ✅ **Excellent** - Flexible provider system

---

## 6. Automatic Configuration System

### 6.1 Configuration Automation Flow

```
Deployment Trigger
       ↓
Generate Docker Compose
       ↓
Generate Environment File
       ↓
Configure Domain (Traefik)
       ↓
Pull & Start Services
       ↓
Wait for Health
       ↓
Sync Configuration to OpenClaude
       ↓
Update YAML Profiles
```

### 6.2 Automatic Variable Management

**Environment Variables:**
```typescript
// Generated .env file
POSTGRES_PASSWORD=<generated>
REDIS_PASSWORD=<generated>
MINIO_ROOT_USER=<generated>
MINIO_ROOT_PASSWORD=<generated>
SYNAP_API_KEY=<generated>
```

**API Key Generation:**
- Automatic generation during `deploy` command
- Stored in credentials.yaml (secure)
- Injected into services via env vars

### 6.3 YAML File Updates

**OpenClaude Profile Sync:**
```typescript
// From deploy.ts
await stateManager.syncToLocal({
  config: {
    hearth: { name: config.domain, role: 'primary' },
    intelligence: {
      provider: 'openai',
      model: 'gpt-4',
      endpoint: `https://${config.domain}/api/hub`
    }
  }
})
```

**Assessment:** ⚠️ **Partial** - Good automation but StateManager is complex

---

## 7. StateManager Analysis

### 7.1 StateManager Responsibilities

The StateManager tries to do too much:

```
StateManager
├── API Client management
├── Runtime state tracking
├── File watching
├── Bidirectional sync
├── Conflict resolution
├── Environment sync
├── Profile translation
└── Cache management
```

**Lines of Code:** 1,162 lines

### 7.2 Issues with StateManager

1. **❌ Too Many Responsibilities** - Violates Single Responsibility Principle
2. **❌ Complex Conflict Resolution** - Hard to understand and test
3. **❌ File Watching + Syncing** - Can cause race conditions
4. **❌ Cache Logic** - Increases complexity, unclear benefit

### 7.3 Recommended Refactoring

Split into focused services:

```
ConfigService           # Load/save Hestia config
CredentialsService      # Load/save credentials
OpenClaudeSync          # Sync to OpenClaude
OpenClawSync            # Sync to OpenClaw
APIService              # Synap backend API client
```

**Simpler sync pattern:**
```typescript
// Instead of StateManager
const config = await configService.load()
await openClaudeSync.sync(config)
await openClawSync.sync(config)
await apiService.push(config)  // Optional
```

---

## 8. Service Architecture Issues

### 8.1 Stub/Re-export Pattern

**Current (Confusing):**
```
src/lib/services/ai-chat-service.ts          # Re-export stub (20 lines)
src/lib/domains/ai/lib/ai-chat-service.ts    # Real implementation (675 lines)
```

**Problem:** Why have both? Commands import from `../lib/services/` which just re-exports from domains.

**Recommendation:** Either:
1. Commands import directly from domains
2. Or services contain the actual logic (domains become pure types)

### 8.2 Service Dependencies

**Current Dependency Graph:**
```
commands/ai.ts
├── services/openclaude-service.ts (re-export)
│   └── domains/ai/lib/openclaude-service.ts (real)
│       ├── utils/config.ts
│       ├── utils/credentials.ts
│       └── domains/ai/lib/openclaw-service.ts ❌
```

**Issue:** OpenClaude service imports from OpenClaw service - tight coupling!

---

## 9. Extensibility Assessment

### 9.1 Current Extensibility Mechanisms

| Mechanism | Status | Assessment |
|-----------|--------|------------|
| **New Commands** | ✅ Easy | Add to `src/commands/` and register in `index.ts` |
| **New Services** | ⚠️ Medium | Add to domains, but need to update re-exports |
| **New AI Providers** | ✅ Easy | Add to `IntelligenceProvider` type and config |
| **New Packages** | ✅ Easy | Add to `PackageType` and docker-compose generator |
| **Plugins** | ❌ Not supported | No plugin system |

### 9.2 Plugin System Gap

**Missing:** No way for third parties to extend Hestia without modifying core code.

**Recommended Plugin Interface:**
```typescript
// hestia-plugin-example/index.ts
export default definePlugin({
  name: 'my-plugin',
  version: '1.0.0',
  
  commands: [
    {
      name: 'my:command',
      description: 'My custom command',
      action: async () => { /* ... */ }
    }
  ],
  
  services: [
    MyCustomService
  ],
  
  hooks: {
    'post-install': async (config) => { /* ... */ }
  }
})
```

---

## 10. Issues Summary & Recommendations

### 10.1 Critical Issues

| # | Issue | Severity | Fix Effort |
|---|-------|----------|------------|
| 1 | StateManager is too complex | High | 4 hours |
| 2 | Commands mix UI and business logic | High | 8 hours |
| 3 | Service stub/re-export confusion | Medium | 2 hours |
| 4 | Tight coupling between domains | Medium | 3 hours |
| 5 | No plugin system | Low | 8 hours |

### 10.2 Recommended Actions

#### Immediate (This Week)
1. **Simplify StateManager** - Extract into focused services
2. **Remove service stubs** - Import directly from domains or move logic
3. **Document architecture** - Add ARCHITECTURE.md

#### Short Term (Next 2 Weeks)
4. **Extract use cases** - Move business logic from commands to `src/application/`
5. **Add interfaces** - Define clear service interfaces
6. **Add tests** - Unit tests for extracted services

#### Long Term (Next Month)
7. **Plugin system** - Allow third-party extensions
8. **Event system** - Decouple components with events
9. **Better error handling** - Consistent error types and recovery

---

## 11. Strengths to Preserve

1. ✅ **Command pattern** - Clean command registration
2. ✅ **Config validation** - Zod schemas are excellent
3. ✅ **Credential separation** - Secure storage pattern
4. ✅ **Docker generation** - Flexible compose generation
5. ✅ **Type safety** - TypeScript types are comprehensive
6. ✅ **Error boundaries** - Global error handlers

---

## 12. Conclusion

**Verdict:** The Hestia CLI is **functional and well-structured** but has **architectural debt** that should be addressed before adding major new features.

**Priority Fixes:**
1. Simplify StateManager (reduces complexity)
2. Extract use cases from commands (improves testability)
3. Remove stub/re-export pattern (reduces confusion)

**Overall Grade:** B+
- Functionality: A
- Code Quality: B
- Architecture: B
- Extensibility: C+
- Documentation: B-

**Ready for server testing?** ✅ **YES** - The current architecture is solid enough for testing, but consider the recommended improvements for v1.0 release.
