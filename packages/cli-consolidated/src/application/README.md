# Hestia CLI Application Layer

This directory contains the **application layer** - pure business logic use cases extracted from the CLI commands.

## Architecture

```
src/application/
├── types.ts              # Shared types and interfaces
├── index.ts              # Main exports
├── usb/                  # USB-related use cases
│   ├── create-bootable-usb.ts
│   ├── detect-devices.ts
│   ├── download-iso.ts
│   └── index.ts
├── install/              # Installation phase use cases
│   ├── run-phase1.ts
│   ├── run-phase2.ts
│   ├── run-phase3.ts
│   └── index.ts
└── deploy/               # Deployment use cases
    ├── deploy-services.ts
    ├── generate-configs.ts
    ├── setup-ai.ts
    └── index.ts
```

## Principles

1. **Pure Business Logic**: Use cases contain only business logic, no UI code
2. **Pure Data I/O**: Take data inputs, return data outputs
3. **Progress Reporting**: Accept a `ProgressReporter` for progress updates
4. **Error Handling**: Return `OperationResult<T>` or throw errors

## ProgressReporter Pattern

All use cases accept a `ProgressReporter` to report progress without UI dependencies:

```typescript
export interface ProgressReporter {
  report(message: string): void;
  onProgress(percent: number): void;
}
```

In CLI commands, create a reporter:

```typescript
const progress: ProgressReporter = {
  report: (msg) => spinner.update('my-spinner', msg),
  onProgress: (pct) => logger.info(`${pct}%`),
};

const result = await createBootableUSB(input, progress);
```

## Line Count Reduction

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| `commands/usb.ts` | 1,387 | ~958 | ~429 lines |
| `commands/install.ts` | 255 | ~262 | Similar (UI-heavy) |
| `commands/deploy.ts` | 389 | ~368 | Similar (UI-heavy) |

The business logic is now in the application layer:

| Application File | Lines |
|------------------|-------|
| `usb/create-bootable-usb.ts` | 385 |
| `usb/detect-devices.ts` | 181 |
| `usb/download-iso.ts` | 172 |
| `install/run-phase1.ts` | 238 |
| `install/run-phase2.ts` | 296 |
| `install/run-phase3.ts` | 391 |
| `deploy/deploy-services.ts` | 280 |
| `deploy/generate-configs.ts` | 423 |
| `deploy/setup-ai.ts` | 351 |

## Usage Example

```typescript
// Command file (UI layer)
import { createBootableUSB, CreateUSBInput } from '../application/usb/index.js';

.command('create')
.action(async (options) => {
  // Create progress reporter
  const progress = {
    report: (msg) => spinner.update('usb', msg),
    onProgress: (pct) => {},
  };

  // Call use case
  const input: CreateUSBInput = {
    device: selectedDevice,
    iso: isoInfo,
    mode: 'safe',
    hearthName: 'My Hearth',
  };

  const result = await createBootableUSB(input, progress);

  // Handle result (UI layer)
  if (result.success) {
    spinner.succeed('USB created!');
  } else {
    spinner.fail(`Failed: ${result.error}`);
  }
});
```

## Benefits

1. **Testability**: Business logic can be unit tested without CLI dependencies
2. **Reusability**: Use cases can be reused in other contexts (GUI, API, etc.)
3. **Maintainability**: Clear separation between UI and business logic
4. **Composability**: Use cases can be combined and chained

## Adding New Use Cases

1. Create a new file in the appropriate domain folder
2. Define input/output interfaces
3. Implement the use case function
4. Export from `index.ts`
5. Import and use in command files
