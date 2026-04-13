# Hestia CLI - Analysis Report

## Executive Summary

The Hestia CLI has been successfully consolidated into a single package with 22 commands. However, **critical gaps exist** between the current implementation and a production-ready CLI. Many core functionalities are placeholders or stubs.

---

## ✅ What Exists & Works

### 1. **Command Structure (22 commands)**
All commands are present and the CLI builds/runs:
- `init`, `status`, `ignite`, `extinguish`
- `ai`, `ai:chat`, `ai:configure`, etc.
- `add`, `remove`, `install`, `package`
- `validate`, `health`, `recovery`
- `hardware`, `os`, `usb`, `provision`
- `tunnel`, `services`, `db:viewer`, `config`, `proxy`

### 2. **Configuration System**
- YAML-based configuration (`~/.hestia/config.yaml`)
- Schema validation with Zod
- Separate credentials file (`~/.hestia/credentials.yaml`) with 0600 permissions
- Environment variable expansion

### 3. **Authentication Infrastructure**
```typescript
// From config.ts - Credentials are properly separated
export async function getCredential(key: string): Promise<string | undefined>
export async function setCredential(key: string, value: string): Promise<void>
// Credentials stored in ~/.hestia/credentials.yaml (mode 0600)
```

### 4. **API Client Foundation**
```typescript
// APIClient exists with Bearer token auth
class APIClient {
  constructor(config: { baseUrl: string; apiKey: string; workspaceId: string })
  // Hub Protocol endpoints (entities.create, entities.update, etc.)
}
```

### 5. **Health Check System**
Comprehensive health monitoring in `health-check.ts`:
- Service checks (Synap Backend, PostgreSQL, Redis, Typesense, OpenClaw, OpenClaude)
- Resource checks (disk, memory, CPU, Docker storage)
- Network checks (internet, DNS, firewall, port bindings)
- Integration checks (state sync, agent connectivity, database, backups)

---

## ⚠️ Critical Gaps & Placeholders

### 1. **No Pre-flight Checks**
**Problem:** Commands don't verify prerequisites before executing.

**Current behavior:**
```typescript
// ignite.ts - Line 65
// Simulate starting package
ctx[`${pkg.name}_started`] = true;
return;
```

**What's missing:**
- ❌ No check if Docker is installed/running before `ignite`
- ❌ No check if API credentials exist before API calls
- ❌ No check if config is valid before operations
- ❌ No check if required ports are available

### 2. **No Interactive Credential Setup**
**Problem:** CLI doesn't guide users through initial authentication setup.

**Current init flow:**
```typescript
// init.ts - Lines 84-96
if (aiPlatform === "opencode") {
  logger.info(`\n📝 OpenCode setup:`);
  logger.info(`   • Get your API key at: https://opencode.ai/api-keys`);
  logger.info(`   • Configure: hestia config set ai.platform.opencode.apiKey <your-key>`);
}
```

**What's missing:**
- ❌ No interactive prompt for API keys during `init`
- ❌ No validation that credentials work before saving
- ❌ No "first-run" wizard for essential configuration
- ❌ Users must manually edit config files

### 3. **Placeholder Implementations**
**Critical functionality is NOT implemented:**

| Command | Status | Issue |
|---------|--------|-------|
| `ignite` | 🟡 Placeholder | Only simulates starting packages (line 66: `// Simulate starting package`) |
| `extinguish` | 🟡 Placeholder | Only simulates stopping (line 88: `// Simulate stopping package`) |
| `add` | 🟡 Placeholder | API client created but not used (`const _api = { baseUrl, apiKey }; // API client placeholder`) |
| `status` | 🟡 Mock | Returns mock data (line 48: `// Get hearth status (mock)`) |
| `provision` | 🟡 Placeholder | Lines 859-860: "Actual implementation would apply kernel settings... This is a placeholder" |
| `usb` | 🟡 Placeholder | Line 1645: "This is a placeholder for the actual USB creation logic" |

### 4. **Missing Pre-execution Validation**
**No command validates inputs before execution:**

```typescript
// Example from add.ts - No validation that package exists
const packageService = new PackageService({...})
// Directly tries to install without checking:
// - If package exists in registry
// - If compatible with current system
// - If dependencies are met
// - If user has permissions
```

### 5. **No Environment Variable Handling**
**Problem:** CLI doesn't read from `.env` files or environment variables for common configs.

**Expected:**
```bash
export HESTIA_API_KEY="sk-..."
export HESTIA_POD_URL="https://..."
hestia status  # Should use env vars
```

**Current:** Must use `hestia config set` manually.

### 6. **Incomplete Error Handling**
**Problem:** Many errors aren't caught or reported usefully.

```typescript
// From ignite.ts
try {
  // Simulate starting package
  ctx[`${pkg.name}_started`] = true;
  return;
} catch (error: any) {
  lastError = error;
  // No specific error handling for different failure modes
}
```

---

## 📋 Authentication & Configuration Audit

### What Exists:
1. ✅ **Credential storage** - Secure YAML file (0600 permissions)
2. ✅ **API client** - Bearer token authentication
3. ✅ **Config schema** - Zod validation
4. ✅ **getCredential/setCredential** - Basic CRUD operations

### What's Missing:
1. ❌ **Credential validation** - No check if API key works before saving
2. ❌ **Interactive setup** - No prompts for missing credentials
3. ❌ **Environment variable fallback** - Doesn't check `process.env.HESTIA_API_KEY`
4. ❌ **Credential rotation** - No commands to update/rotate keys
5. ❌ **Multi-profile support** - Can't switch between different server configs
6. ❌ **Secure input** - Passwords shown in plain text during `config set`

---

## 🎯 Separation of Concerns Analysis

### ✅ Well Separated:
1. **USB vs CLI** - USB is separate concern (OS installation vs management)
2. **Config vs Credentials** - Properly separated files
3. **API Client** - Isolated in `api-client.ts`
4. **Health Checks** - Comprehensive system in `health-check.ts`

### ❌ Needs Improvement:
1. **Command Logic** - Commands mix CLI UI with business logic
2. **State Management** - Unclear separation between local state and remote sync
3. **Service Layer** - Many services are thin wrappers around placeholders
4. **Error Handling** - Inconsistent across commands

---

## 🔧 Recommended Next Steps

### Priority 1: Pre-flight Checks (Critical)
Create a `preFlightCheck()` utility:

```typescript
// lib/utils/preflight.ts
export async function preFlightCheck(requirements: {
  docker?: boolean;
  credentials?: string[];
  config?: boolean;
  ports?: number[];
}): Promise<{ ok: boolean; errors: string[] }>
```

Use in every command:
```typescript
// ignite.ts
const check = await preFlightCheck({ 
  docker: true, 
  credentials: ['apiKey'],
  config: true 
});
if (!check.ok) {
  logger.error("Pre-flight checks failed:");
  check.errors.forEach(e => logger.error(`  - ${e}`));
  process.exit(1);
}
```

### Priority 2: Interactive Init Wizard
Replace current `init` with proper wizard:

```typescript
// Interactive prompts for:
// 1. Hearth name
// 2. AI Platform (OpenCode/OpenClaude/later)
// 3. API Key (masked input, with validation)
// 4. Pod URL (with default: http://localhost:4000)
// 5. Test connection before saving
```

### Priority 3: Implement Real Package Management
Replace placeholders with actual Docker/systemd calls:

```typescript
// ignite.ts - Real implementation
async function startPackage(name: string): Promise<void> {
  // Check if Docker container exists
  // Start container
  // Wait for health check
  // Update status
}
```

### Priority 4: Environment Variable Support
Add to config loading:

```typescript
// lib/utils/config.ts
function loadConfig(): HestiaConfig {
  const fileConfig = loadFromFile();
  const envConfig = {
    pod: {
      url: process.env.HESTIA_POD_URL,
      apiKey: process.env.HESTIA_API_KEY,
    }
  };
  return mergeConfigs(fileConfig, envConfig);
}
```

---

## 📊 Current State Summary

| Component | Status | Notes |
|-----------|--------|-------|
| CLI Framework | ✅ Complete | Commander.js, 22 commands |
| Build System | ✅ Complete | tsup, ESM, 908KB bundle |
| Config Schema | ✅ Complete | Zod validation |
| Health Monitoring | ✅ Complete | Comprehensive checks |
| API Client | 🟡 Partial | Structure exists, not fully used |
| Credential Mgmt | 🟡 Partial | Storage works, no validation |
| Package Ops | 🔴 Placeholder | ignite/extinguish/add are stubs |
| USB Creation | 🔴 Placeholder | Not implemented |
| Pre-flight Checks | 🔴 Missing | No validation before execution |
| Interactive Setup | 🔴 Missing | No wizard for initial config |

---

## Conclusion

The CLI has **excellent foundations** (build system, command structure, health checks) but **lacks executable implementations**. The current state is suitable for:
- ✅ Demonstrating the CLI structure
- ✅ Configuration management
- ✅ Health monitoring
- ❌ **NOT suitable for production use** (core operations are placeholders)

**Next priority:** Implement real package management (ignite/extinguish) and add pre-flight checks.
