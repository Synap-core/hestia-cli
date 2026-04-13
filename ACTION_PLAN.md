# Hestia CLI - Action Plan

## Current Status (Post-Push)

✅ **Pushed to main:** `fa00403` - Working build with AI commands fixed
✅ **Documentation created:**
- `CURRENT_STATE.md` - Current architecture summary
- `READY_FOR_PRODUCTION.md` - Usage guide
- `TYPESCRIPT_ERRORS.md` - Error analysis
- `ARCHITECTURE_ANALYSIS.md` - Structure analysis

---

## Immediate Actions (This Week)

### 1. Fix Critical TypeScript Errors (30 min)

**Priority: HIGH** - Fixes developer experience

```bash
# Fix 1: Export naming (Category 6)
# File: src/lib/utils/credentials.ts
# Change: export function getCredential -> getCredentials

# Fix 2: Add missing config properties (Category 5)
# File: src/lib/types/index.ts
# Add: _packagesDir?: string, _configDir?: string

# Fix 3: Deploy command null checks (Category 7)
# File: src/commands/deploy.ts
# Add: Default values or null checks for options
```

**Expected Result:** `npm run typecheck` shows fewer errors

---

### 2. Document Remaining TypeScript Errors (15 min)

**Priority: MEDIUM** - Helps future developers

Add to `TYPESCRIPT_ERRORS.md`:
```markdown
## Quick Reference Card

| Error | File | Line | Quick Fix |
|-------|------|------|-----------|
| Cannot find module | ai-chat-service.ts | 18 | Path resolution - see Category 1 |
| Property does not exist | ai-chat.ts | 77 | Add explicit return type |
| Expected 0 arguments | ai.ts | 250 | Fix import paths first |
```

---

### 3. Commit Documentation (5 min)

```bash
git add TYPESCRIPT_ERRORS.md ARCHITECTURE_ANALYSIS.md
git commit -m "docs: add architecture and error analysis

- Document all TypeScript error categories
- Add architecture analysis with 3 options
- Create prioritized action plan
- No code changes"
git push origin main
```

---

## Short Term (Next 2 Weeks)

### 4. Consolidate Packages (4 hours)

**Priority: HIGH** - Reduces maintenance burden

**Goal:** Single `packages/cli/` instead of 5+ packages

**Steps:**

1. Create new `packages/cli/` from `cli-consolidated/`
   ```bash
   cp -r packages/cli-consolidated packages/cli
   cd packages/cli
   # Update package.json name: "@hestia/cli"
   ```

2. Audit and move code from other packages:
   ```
   packages/ai/ -> packages/cli/src/features/ai/
   packages/usb/ -> packages/cli/src/features/usb/
   packages/types/ -> packages/cli/src/shared/types/
   packages/utils/ -> packages/cli/src/shared/utils/
   packages/core/ -> packages/cli/src/shared/core/
   ```

3. Update imports:
   ```typescript
   // Before:
   import { AIChatProvider } from '@hestia/types';
   
   // After:
   import { AIChatProvider } from '../shared/types/ai.js';
   ```

4. Test build:
   ```bash
   cd packages/cli
   npm install
   npm run build
   ```

5. Deprecate old packages (update README with deprecation notice)

---

### 5. Extract Services from Large Commands (8 hours)

**Priority: HIGH** - Improves maintainability

**Target files:**
- `usb.ts` (1,387 lines) → Extract to services
- `ai.ts` (573 lines) → Already good, minor cleanup
- `openclaw-service.ts` (1,082 lines) → Split into modules
- `openclaude-service.ts` (819 lines) → Split into modules

**Example: USB Command Refactor**

```typescript
// Before: src/commands/usb.ts (1387 lines)

// After: src/commands/usb.ts (150 lines)
import { USBCreator } from '../services/usb/creator.js';
import { USBDetector } from '../services/usb/detector.js';
import { ISODownloader } from '../services/usb/downloader.js';

export function usbCommand(program: Command): void {
  program
    .command('usb')
    .action(async () => {
      const device = await USBDetector.selectDevice();
      const image = await ISODownloader.selectImage();
      await USBCreator.create(device, image);
    });
}

// New: src/services/usb/creator.ts (400 lines)
export class USBCreator {
  async create(device: USBDevice, image: ISOImage): Promise<void> {
    // Creation logic
  }
}

// New: src/services/usb/detector.ts (200 lines)
export class USBDetector {
  async listDevices(): Promise<USBDevice[]> { }
  async selectDevice(): Promise<USBDevice> { }
}

// New: src/services/usb/downloader.ts (300 lines)
export class ISODownloader {
  async download(url: string): Promise<ISOImage> { }
  async selectImage(): Promise<ISOImage> { }
}

// New: src/services/usb/ventoy.ts (337 lines)
export class VentoyService {
  async install(device: USBDevice): Promise<void> { }
  async check(device: USBDevice): Promise<boolean> { }
}
```

---

### 6. Consolidate Type Definitions (4 hours)

**Priority: MEDIUM** - Single source of truth

**Current:**
- `src/lib/types/index.ts` (503 lines)
- `src/lib/types/extra-types.ts` (156 lines)
- Inline types in services

**Target:**
```
src/shared/types/
├── index.ts           # Re-exports
├── core.ts            # Package, Hearth, Config types
├── ai.ts              # All AI-related types
├── usb.ts             # All USB-related types
└── cli.ts             # Command option types
```

**Migration:**
```typescript
// src/shared/types/ai.ts
export interface AIChatProviderConfig { }
export interface AIChatProviderStatus { }
export interface AIChatProviderInfo { }
export interface OpenClaudeConfig { }
export interface MCPInstalledServer { }
// ... all AI types here

// src/shared/types/index.ts
export * from './core.js';
export * from './ai.js';
export * from './usb.js';
export * from './cli.js';
```

---

## Medium Term (Next Month)

### 7. Add Comprehensive Tests (16 hours)

**Priority: HIGH** - Ensures reliability

**Structure:**
```
src/
├── features/
│   ├── ai/
│   │   ├── commands/
│   │   ├── services/
│   │   └── __tests__/        # Feature tests
│   │       ├── commands.test.ts
│   │       └── services.test.ts
│   └── ...
└── shared/
    └── __tests__/            # Shared tests
```

**Test Types:**
- Unit tests for services
- Integration tests for commands
- E2E tests for critical paths (USB creation, installation)

---

### 8. Improve Error Handling (8 hours)

**Priority: MEDIUM** - Better UX

**Current:**
```typescript
try {
  await something();
} catch (error: any) {
  logger.error(`Failed: ${error.message}`);
  process.exit(1);
}
```

**Target:**
```typescript
// Custom error classes
export class USBError extends HestiaError {
  constructor(message: string, public device: string) {
    super(message, 'USB_ERROR', 10);
  }
}

// Structured error handling
try {
  await something();
} catch (error) {
  if (error instanceof USBError) {
    logger.error(`USB Error on ${error.device}: ${error.message}`);
    logger.info('Try: hestia usb:list to see available devices');
  } else {
    logger.error('Unexpected error', { error });
  }
  process.exit(error.exitCode || 1);
}
```

---

### 9. Add CI/CD Pipeline (4 hours)

**Priority: MEDIUM** - Automation

**GitHub Actions workflow:**
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run typecheck    # Will fail until errors fixed
      - run: npm run build
      - run: npm test
      - run: npm run lint
```

---

## Long Term (Next Quarter)

### 10. Plugin System (40 hours)

**Priority: LOW** - Future extensibility

Allow third-party plugins:
```typescript
// hestia-plugin-example/index.ts
export default definePlugin({
  name: 'example',
  commands: [
    {
      name: 'example:hello',
      action: async () => console.log('Hello!')
    }
  ]
});
```

---

### 11. GUI Mode (80 hours)

**Priority: LOW** - Nice to have

Alternative to CLI:
```bash
hestia --gui  # Launches web-based GUI
```

---

## Priority Matrix

| # | Action | Effort | Impact | Priority |
|---|--------|--------|--------|----------|
| 1 | Fix critical type errors | 30 min | High | 🔴 Critical |
| 2 | Document errors | 15 min | Medium | 🟡 High |
| 3 | Commit docs | 5 min | Low | 🟢 Medium |
| 4 | Consolidate packages | 4 hrs | High | 🔴 Critical |
| 5 | Extract services | 8 hrs | High | 🔴 Critical |
| 6 | Consolidate types | 4 hrs | Medium | 🟡 High |
| 7 | Add tests | 16 hrs | High | 🟡 High |
| 8 | Error handling | 8 hrs | Medium | 🟢 Medium |
| 9 | CI/CD | 4 hrs | Medium | 🟢 Medium |
| 10 | Plugin system | 40 hrs | Low | ⚪ Low |
| 11 | GUI mode | 80 hrs | Low | ⚪ Low |

---

## Success Metrics

**Week 1:**
- [ ] TypeScript errors reduced by 50%
- [ ] Documentation complete

**Month 1:**
- [ ] Single package structure
- [ ] All commands < 200 lines
- [ ] Types consolidated
- [ ] Basic test coverage

**Quarter 1:**
- [ ] 80% test coverage
- [ ] CI/CD passing
- [ ] Plugin system design

---

## Resources Needed

| Role | Time | Tasks |
|------|------|-------|
| Senior Dev | 40 hrs | Package consolidation, service extraction |
| Mid Dev | 24 hrs | Tests, error handling |
| Junior Dev | 8 hrs | Documentation, CI/CD |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Refactor breaks build | Do incremental changes, test each step |
| Package consolidation breaks imports | Use IDE refactor tools, test thoroughly |
| Tests take too long | Start with critical paths only |
| TypeScript errors persist | Document as known issues, fix incrementally |

---

## Next Steps (Start Here)

1. **Right now:** Review this action plan
2. **Today:** Do items 1-3 (fix critical errors, document, commit)
3. **This week:** Start item 4 (package consolidation)
4. **Next week:** Continue with item 5 (service extraction)

---

## Questions to Resolve

1. **Package consolidation:** Should we keep `cli-consolidated` name or rename to `cli`?
2. **Test framework:** Jest, Vitest, or Node.js test runner?
3. **CI/CD:** GitHub Actions, or other platform?
4. **Plugin system:** Is this a real requirement or YAGNI?

**Recommended:**
1. Rename to `cli` (cleaner)
2. Use Vitest (already in package.json)
3. GitHub Actions (repo is on GitHub)
4. Defer plugin system (not needed yet)
