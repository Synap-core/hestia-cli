# Hestia CLI - What Needs To Be Done

## ✅ Completed (Today)

### Code
- [x] Fixed corrupted `ai.ts` command (573 lines → working)
- [x] Added proper type definitions (`ProviderConfig`, `MCPInstalledServer`)
- [x] Fixed `ai-chat-service.ts` return types
- [x] Build successful: `dist/index.js` (947 KB)

### Documentation
- [x] `CURRENT_STATE.md` - Current architecture summary
- [x] `READY_FOR_PRODUCTION.md` - Usage and readiness guide  
- [x] `TYPESCRIPT_ERRORS.md` - All 50+ TypeScript errors categorized
- [x] `ARCHITECTURE_ANALYSIS.md` - Structure analysis with 3 improvement options
- [x] `ACTION_PLAN.md` - Prioritized roadmap with timelines

### Git
- [x] Pushed to main: `9b778af` - All documentation and fixes

---

## 🔄 Next Actions (Priority Order)

### Immediate (Today/Tomorrow)

#### 1. Fix Critical TypeScript Errors (30 minutes)
**Files to modify:**
```typescript
// src/lib/utils/credentials.ts
// Change line X:
export function getCredential(...)  // Add 's' to become getCredentials

// src/lib/types/index.ts
// Add after line 236:
_packagesDir?: string;
_configDir?: string;

// src/commands/deploy.ts
// Lines 212-228: Add default values
const profile = options.profile ?? 'full';
const platform = options.platform ?? 'none';
```

**Why:** These 3 fixes will reduce type errors by ~30%

---

#### 2. Update README.md (1 hour)
The README should reflect the current structure:

```markdown
# Hestia CLI

Sovereign infrastructure deployment CLI.

## Installation

\`\`\`bash
npm install -g @hestia/cli
# or
npx @hestia/cli@latest
\`\`\`

## Quick Start

\`\`\`bash
# Create bootable USB
hestia usb

# Install Hestia
hestia install all

# Start AI assistant
hestia ai:setup
hestia ai
\`\`\`

## Documentation

- [TypeScript Errors](./TYPESCRIPT_ERRORS.md) - Known issues
- [Architecture](./ARCHITECTURE_ANALYSIS.md) - Code structure
- [Action Plan](./ACTION_PLAN.md) - Roadmap
```

---

### Short Term (This Week)

#### 3. Package Consolidation (4 hours)
**Decision needed:** Should we consolidate 5 packages into 1?

**Current situation:**
- `packages/cli-consolidated/` - Works ✅
- `packages/ai/` - Broken
- `packages/core/` - Broken
- `packages/types/` - Redundant
- `packages/usb/` - Redundant

**Recommended:** 
1. Create `packages/cli/` from `cli-consolidated/`
2. Move useful code from other packages
3. Deprecate old packages
4. Update imports

**Why:** Single package = single build = less maintenance

---

#### 4. Extract Services from Commands (8 hours)
**Files that need splitting:**

| File | Lines | Extract To |
|------|-------|------------|
| `usb.ts` | 1,387 | `services/usb/*.ts` (4 files) |
| `openclaw-service.ts` | 1,082 | `services/ai/openclaw/*.ts` (3 files) |
| `openclaude-service.ts` | 819 | `services/ai/openclaude/*.ts` (3 files) |

**Template:**
```typescript
// Before: commands/usb.ts (1387 lines)

// After: 
// - commands/usb.ts (150 lines - thin wrapper)
// - services/usb/creator.ts (400 lines)
// - services/usb/detector.ts (200 lines)
// - services/usb/downloader.ts (300 lines)
// - services/usb/ventoy.ts (337 lines)
```

**Why:** Commands >500 lines are hard to maintain

---

#### 5. Consolidate Type Definitions (4 hours)
**Current:** Types scattered across 3+ files

**Target:**
```
src/shared/types/
├── index.ts      # Re-exports
├── core.ts       # Package, Hearth types
├── ai.ts         # AI types (consolidated)
├── usb.ts        # USB types
└── config.ts     # Config types
```

**Why:** Single source of truth for types

---

### Medium Term (Next 2 Weeks)

#### 6. Add Test Coverage (16 hours)
**What to test:**
- Unit tests for services
- Integration tests for commands
- E2E tests for: USB creation, installation, AI setup

**Framework:** Vitest (already in package.json)

**Structure:**
```
src/
├── features/
│   └── ai/
│       ├── commands/
│       ├── services/
│       └── __tests__/
│           ├── commands.test.ts
│           └── services.test.ts
```

**Why:** Prevents regressions, enables confident refactoring

---

#### 7. CI/CD Pipeline (4 hours)
**GitHub Actions workflow:**
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
      - run: npm test
```

**Why:** Automated testing and validation

---

#### 8. Error Handling Improvements (8 hours)
**Current:** Generic try/catch with process.exit(1)

**Target:** Structured error handling
```typescript
// Custom error classes
export class USBError extends HestiaError {
  constructor(device: string, message: string) {
    super(message, 'USB_ERROR', 10);
    this.device = device;
  }
}

// Usage
try {
  await createUSB(device);
} catch (error) {
  if (error instanceof USBError) {
    logger.error(`USB Error on ${error.device}`);
    logger.info('Run: hestia usb:list to see devices');
  }
}
```

**Why:** Better user experience, easier debugging

---

## 📊 Summary

| Category | Count | Time Estimate |
|----------|-------|---------------|
| Critical Fixes | 3 items | 1.5 hours |
| Package Work | 2 items | 12 hours |
| Code Quality | 3 items | 28 hours |
| **Total** | **8 items** | **~42 hours** |

---

## 🎯 Success Criteria

**Week 1:**
- [ ] TypeScript errors reduced from 50+ to <20
- [ ] Documentation complete and accurate
- [ ] README updated

**Month 1:**
- [ ] Single consolidated package
- [ ] All commands < 200 lines
- [ ] Types in single location
- [ ] Basic test coverage (>30%)

**Quarter 1:**
- [ ] TypeScript errors: 0
- [ ] Test coverage: >80%
- [ ] CI/CD passing
- [ ] Ready for v1.0 release

---

## 🤔 Open Questions

1. **Package name:** Keep `@hestia/cli-consolidated` or rename to `@hestia/cli`?
2. **Node version:** Minimum supported version?
3. **Plugin system:** Is this needed or YAGNI?
4. **GUI mode:** Future feature or out of scope?

**Recommendations:**
1. Rename to `@hestia/cli` (cleaner)
2. Support Node 18+ (LTS)
3. Defer plugins (not needed yet)
4. Defer GUI (CLI is primary interface)

---

## 📁 Key Files

**Documentation:**
- `README.md` - Main documentation (needs update)
- `CURRENT_STATE.md` - Architecture snapshot
- `READY_FOR_PRODUCTION.md` - Usage guide
- `TYPESCRIPT_ERRORS.md` - Error reference
- `ARCHITECTURE_ANALYSIS.md` - Structure analysis
- `ACTION_PLAN.md` - Roadmap

**Code (Main CLI):**
- `packages/cli-consolidated/src/commands/` - 22 commands
- `packages/cli-consolidated/src/lib/services/` - Business logic
- `packages/cli-consolidated/src/lib/types/` - Type definitions
- `packages/cli-consolidated/src/lib/utils/` - Utilities

**Build:**
- `packages/cli-consolidated/package.json`
- `packages/cli-consolidated/tsconfig.json`
- `packages/cli-consolidated/tsup.config.ts`

---

## 🚀 How to Start

1. **Review this document** - Understand the full picture
2. **Do Item 1** - Fix critical TypeScript errors (30 min)
3. **Update README** - Document current state (1 hour)
4. **Pick your priority** - Package consolidation OR service extraction
5. **Work incrementally** - Small PRs, not big bang

---

## 📞 Need Help?

Refer to:
- `TYPESCRIPT_ERRORS.md` - Specific error fixes
- `ARCHITECTURE_ANALYSIS.md` - Design decisions
- `ACTION_PLAN.md` - Detailed timelines

---

## Status

Last Updated: 2026-04-13
Current Commit: `9b778af`
Build Status: ✅ Working
TypeScript Errors: ⚠️ 50+ (non-blocking)
