# Hestia CLI

Command-line interface for Hestia - Sovereign AI Infrastructure

## 🚀 **New Features - April 2025**

### 🔥 **AI Platform Integration**
- **OpenCode/OpenClaude choice** during `hestia init`
- **Interactive guidance** for API key setup
- **Type-safe configuration** with AI platform preferences
. **OpenCode (recommended)**: Claude Code IDE for development
. **OpenClaude**: AI builder for creating apps
. **Configure later**: Flexible setup options

### 💾 **One-Command USB Deployment - Transform Any USB Key into a Bootable AI System**

**Create a complete bootable Hestia AI system on any USB drive:**

```bash
# Generate the USB bundle (creates directory structure)
hestia usb generate --output ./hestia-usb --bundle-all

# For complete production deployment with all components:
hestia usb generate --output ./production-usb --bundle-all --include-docker --include-backend
```

**What's included in the USB bundle:**
```
📁 hestia-usb/
├── 📁 bin/                    # Hestia CLI executable
├── 📁 scripts/               # Automatic installation scripts
│   └── install.sh           # One-command setup (run as root)
├── 📁 config/                # Production configurations
├── 📁 docker/                # Docker Compose files
├── 📁 docs/                  # Complete documentation
├── 📁 iso/                   # Bootable ISO configuration  
├── 📁 autoinstall/           # Automated deployment (Ubuntu/Debian)
└── 📁 cloud-init/            # Cloud initialization configs
```

**🚀 Three Ways to Deploy:**

1. **Direct USB Boot** (Recommended for bare metal):
   ```bash
   # Copy to USB drive
   sudo cp -r hestia-usb/* /media/USB/
   
   # Boot from USB, then run:
   sudo ./scripts/install.sh
   ```

2. **Network Boot/PXE** (Data centers, labs):
   ```bash
   # Extract to TFTP/NFS server
   tar -czf hestia-boot.tar.gz hestia-usb/
   
   # Configure PXE to boot and auto-run install.sh
   ```

3. **Virtual Machine** (Testing/development):
   ```bash
   # Create VM with USB content as virtual disk
   qemu-img create -f qcow2 hestia-vm.qcow2 20G
   # Mount hestia-usb/ as CD-ROM or secondary disk
   ```

**⚡ Installation Process (automated):**
- Detects Linux distribution (Ubuntu/Debian/RHEL/Arch)
- Installs dependencies (Docker, Node.js, PostgreSQL, Redis)
- Creates systemd services for auto-start
- Configures networking and security
- Sets up Hestia with your AI platform choice

**🔧 Customization Options:**
```bash
# Specific output format
hestia usb generate --format iso          # Creates bootable ISO
hestia usb generate --format both         # Directory + ISO

# Custom volume label  
hestia usb generate --label "HESTIA_AI"

# Include specific components
hestia usb generate --include-docker      # Docker files
hestia usb generate --include-backend     # Synap backend services

# Use existing base ISO
hestia usb generate --iso-path ./ubuntu-22.04.iso
```

**📋 System Requirements for USB Boot:**
- **USB drive**: 8GB+ (16GB recommended)
- **Target system**: x86_64 or ARM64
- **Memory**: 4GB RAM minimum, 8GB+ recommended
- **Storage**: 20GB+ free disk space
- **Network**: Internet access for package installation

**🎯 Use Cases:**
- **Field deployment**: Boot on any compatible hardware
- **Disaster recovery**: Complete system restore from USB
- **Demo/POC kits**: Portable AI demonstrations
- **Air-gapped networks**: Offline installation
- **Training environments**: Consistent setup for workshops

**🔒 Security Features:**
- Signed installation scripts
- Secure default configurations
- No external telemetry
- Local-first operation
- Encrypted credential storage

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

# Initialize Hestia with AI platform choice
hestia init

# Check status
hestia status

# Start all services
hestia ignite

# Generate bootable USB for field deployment
hestia usb generate --bundle-all --output ./hestia-usb
```

## Installation Methods

### 1. **Direct Script Install** (Simplest)
```bash
curl -fsSL https://get.hestia.dev | bash
```

### 2. **One-Command USB Deployment** (Production Ready)
```bash
# Generate complete bootable USB
hestia usb generate --bundle-all --output ./synap-usb

# Options:
# --format iso          # Create bootable ISO
# --label HESTIA_BOOT   # Custom volume label
# --include-backend     # Include backend services
# --include-docker     # Include Docker configuration
```

**Creates:**
```
synap-usb/
├── bin/hestia          # CLI executable
├── scripts/install.sh  # Automatic installer
├── config/            # Production configs
├── docker/            # Docker compose files
├── docs/README.md     # Complete documentation
└── iso/              # Bootable ISO config (if --format iso)
```

### 3. **Advanced USB Install** (Legacy)
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

## 🎯 **What Makes Hestia Unique**

### 🔐 **Sovereign AI Infrastructure**
- **Your data stays yours** - No cloud lock-in
- **OpenAI-compatible API** - Use any AI model
- **Multi-tenant pods** - Shared or dedicated deployment
- **Proposal governance** - AI actions require human approval

### 🚀 **Production Deployment Features**
- **One-command USB generation** - Deploy anywhere
- **Auto-install with cloud-init** - Zero-touch provisioning
- **Docker Compose production configs** - Battle-tested
- **Systemd service management** - Enterprise reliability

### 🤖 **AI Platform Integration**
- **OpenCode + OpenClaude support** - Best of both worlds
- **Interactive setup wizard** - Guided configuration
- **API key management** - Secure credential handling
- **Intelligent defaults** - Works out of the box

### 🔧 **Developer Experience**
- **TypeScript-first** - Full type safety
- **Modular monorepo** - Clean separation of concerns
- **Centralized type system** - Verified at build time
- **Zero-config testing** - Integrated test suite

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
