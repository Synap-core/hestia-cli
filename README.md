# Hestia CLI

Command-line interface for Hestia - Sovereign AI Infrastructure

## Packages

This monorepo contains the following packages:

| Package | Description | Path |
|---------|-------------|------|
| `@hestia/cli` | Main CLI application | `packages/core/` |
| `@hestia/install` | System installer scripts | `packages/install/` |
| `@hestia/usb` | USB creation tools | `packages/usb/` |

## Quick Start

```bash
# Install CLI globally
npm install -g @hestia/cli

# Initialize Hestia
hestia init

# Check status
hestia status

# Start all services
hestia ignite
```

## Installation Methods

### 1. Direct Script Install
```bash
curl -fsSL https://get.hestia.dev | bash
```

### 2. USB Install
Create a bootable USB with Hestia installer:
```bash
cd packages/usb
sudo bash src/create-usb.sh
```

### 3. Manual Package Install
```bash
# Clone repository
git clone https://github.com/synap/hestia.git
cd hestia-cli

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Link CLI globally
pnpm link --global
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run CLI in development
pnpm --filter @hestia/cli dev -- status

# Type check
pnpm typecheck

# Lint
pnpm lint

# Test
pnpm test
```

## Project Structure

```
hestia-cli/
├── packages/
│   ├── core/           # CLI application
│   │   ├── src/
│   │   │   ├── commands/    # CLI commands
│   │   │   ├── lib/         # Utilities
│   │   │   └── types.ts     # TypeScript definitions
│   │   └── package.json
│   ├── install/        # System installer
│   │   └── src/
│   │       ├── install.sh
│   │       ├── phases/
│   │       │   ├── phase1.sh
│   │       │   ├── phase2.sh
│   │       │   └── phase3.sh
│   │       └── wizard/
│   │           └── first-fire.sh
│   └── usb/            # USB creation tools
│       └── src/
│           ├── create-usb.sh
│           └── ventoy/
├── package.json        # Workspace root
└── pnpm-workspace.yaml
```

## Commands

### Core Commands
- `hestia init` - Initialize Hestia configuration
- `hestia status` - Check system status
- `hestia ignite` - Start all packages
- `hestia extinguish` - Stop all packages
- `hestia install [phase]` - Run installation phases

### Package Management
- `hestia add <name>` - Add a package
- `hestia remove <name>` - Remove a package
- `hestia package list` - List installed packages
- `hestia package info <name>` - Show package details
- `hestia package logs <name>` - Show package logs
- `hestia package update [name]` - Update packages

### Configuration
- `hestia config` - View configuration
- `hestia config get <key>` - Get value
- `hestia config set <key> <value>` - Set value
- `hestia config wizard` - Interactive configuration

## Architecture

### Entity-First Design
All Hestia concepts are stored as entities in Synap Backend:
- `hearth_node` - Node configuration and status
- `intelligence_provider` - AI provider settings
- `package_instance` - Installed packages
- `hearth_deployment` - Deployment history

### Installation Phases
1. **Phase 1** - Foundation: Docker, firewall, SSH hardening
2. **Phase 2** - Core: Synap Backend, OpenClaw gateway
3. **Phase 3** - Builder: OpenClaude agent, A2A bridge

### Intelligence Agnostic
Works with any OpenAI-compatible provider:
- **Ollama** (local, free)
- **OpenRouter** (multi-provider)
- **Anthropic Claude**
- **OpenAI**
- **Custom endpoints**

## Environment Variables

- `HESTIA_HOME` - Installation directory (default: `/opt/hestia`)
- `HESTIA_TARGET` - Target directory for installs
- `HESTIA_SAFE_MODE` - Preserve existing data
- `HESTIA_UNATTENDED` - Non-interactive mode

## Documentation

- [CLI Documentation](packages/core/README.md)
- [Installer Guide](packages/install/README.md)
- [USB Creation](packages/usb/README.md)

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md)

## License

MIT
