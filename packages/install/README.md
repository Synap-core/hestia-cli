# @hestia/install - System Installer

**Bash-based system installation scripts for Hestia infrastructure**

---

## 📋 Package Role

**Purpose:** System-level installation and configuration

**Scope:**
- Operating system preparation
- Base infrastructure installation (Docker, networking, security)
- Hestia service deployment
- Initial system hardening

**When to Use:**
- Called automatically by USB installer during OS setup
- Manual installation on existing systems
- Recovery and reinstallation scenarios
- Phase-by-phase system updates

**Key Characteristic:** Idempotent - safe to run multiple times

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         install.sh (Entry Point)        │
│  - Parse arguments                        │
│  - Track state                            │
│  - Dispatch to phases                     │
└──────────────────┬──────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────▼────────┐   ┌────────▼──────────┐
│  Phase 1       │   │  Phase 2          │
│  (Foundation)  │   │  (Core + Gateway) │
│                │   │                   │
│ - System updates│   │ - PostgreSQL      │
│ - Docker        │   │ - Typesense       │
│ - Firewall      │   │ - Redis           │
│ - SSH hardening │   │ - Synap Backend   │
│ - User creation │   │ - OpenClaw        │
└────────┬───────┘   └────────┬──────────┘
         │                    │
         └──────────┬─────────┘
                    │
         ┌──────────▼──────────┐
         │  Phase 3            │
         │  (Builder)          │
         │                     │
         │ - AI provider       │
         │ - OpenClaude        │
         │ - A2A Bridge        │
         │ - Skills setup      │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │  first-fire.sh      │
         │  (Interactive)      │
         └─────────────────────┘
```

---

## 🛠️ Technologies

### Scripting
| Technology | Purpose |
|------------|---------|
| **Bash** | Shell scripting (primary) |
| **curl/wget** | Downloads |
| **systemd** | Service management |

### System Tools
| Tool | Purpose |
|------|---------|
| **apt/dnf** | Package management |
| **Docker** | Container runtime |
| **Docker Compose** | Multi-container orchestration |
| **UFW** | Firewall |
| **fail2ban** | Intrusion prevention |
| **OpenSSL** | Certificate generation |

### Installation Methods
| Method | When Used |
|--------|-----------|
| **apt** | System packages |
| **Docker** | Services (Synap, OpenClaw, etc.) |
| **npm** | Node.js packages (OpenClaude) |
| **git** | Source installation |
| **curl** | Binary downloads |

---

## 📁 File Structure

```
packages/install/
├── package.json               # Package metadata
├── README.md                  # This file
└── src/
    ├── install.sh             # Main installer (4.2 KB)
    │   └── Features:
    │       - Argument parsing (--force, --resume, --dry-run, --reset)
    │       - State tracking (.install-state)
    │       - Phase dispatch
    │       - Progress reporting
    │
    ├── phases/
    │   ├── phase1.sh          # Foundation (5.8 KB)
    │   │   └── Components:
    │   │       - update_system()
    │   │       - install_docker()
    │   │       - configure_firewall()
    │   │       - harden_ssh()
    │   │       - create_user()
    │   │       - configure_fail2ban()
    │   │       - create_systemd_service()
    │   │
    │   ├── phase2.sh          # Core + Gateway (7.2 KB)
    │   │   └── Components:
    │   │       - create_env_files()
    │   │       - create_docker_compose()
    │   │       - create_nginx_config()
    │   │       - create_init_scripts()
    │   │       - start_core_services()
    │   │
    │   └── phase3.sh          # Builder (6.9 KB)
    │       └── Components:
    │           - configure_intelligence()
    │           - install_openclaude()
    │           - configure_a2a()
    │           - create_workspace_template()
    │           - update_docker_compose()
    │           - seed_initial_data()
    │           - create_management_scripts()
    │           - start_builder_services()
    │
    └── wizard/
        └── first-fire.sh      # Interactive setup (4.5 KB)
            └── Features:
                - TUI with whiptail/dialog
                - Hearth name configuration
                - AI provider selection
                - Comms setup (Telegram/WhatsApp)
                - Admin account creation
                - Configuration summary
```

---

## 🔄 Installation Phases

### Phase 1: Foundation

**Purpose:** Prepare the operating system

**Components Installed:**
1. **System Updates** - Latest packages and security patches
2. **Docker & Docker Compose** - Container runtime
3. **UFW Firewall** - Network security
   - Ports: 22 (SSH), 80/443 (HTTP), 3000/4000/3001 (Hestia)
4. **SSH Hardening** - Secure remote access
   - Disable root login
   - Key-based auth
   - Fail2ban integration
5. **Hestia User** - Dedicated service account
6. **Systemd Services** - Auto-start on boot

**Duration:** 5-10 minutes
**State File:** `.install-state.d/phase1-*`

### Phase 2: Core + Gateway

**Purpose:** Deploy Hestia infrastructure services

**Services Installed:**
1. **PostgreSQL + pgvector** - Database with vector support
2. **Typesense** - Search engine
3. **Redis** - Caching and message queue
4. **Synap Backend** - Knowledge graph API
5. **OpenClaw** - Multi-channel gateway
6. **Nginx** - Reverse proxy and SSL

**Configuration:**
- Environment files with secure passwords
- Docker Compose orchestration
- SSL certificates (self-signed or Let's Encrypt)
- Database initialization scripts

**Duration:** 10-15 minutes
**State File:** `.install-state.d/phase2-*`

### Phase 3: Builder

**Purpose:** Install AI and agent capabilities

**Components Installed:**
1. **AI Provider** - Ollama (local) or cloud API
2. **OpenClaude** - AI coding assistant
3. **A2A Bridge** - Agent communication
4. **Initial Workspace** - Default entities and views
5. **Management Scripts** - CLI wrappers

**Configuration:**
- AI model selection
- Provider configuration
- API key setup
- Skills initialization

**Duration:** 10-20 minutes (depends on AI model download)
**State File:** `.install-state.d/phase3-*`

---

## 🎯 Idempotency Features

### State Tracking
```bash
# Track completed steps
.install-state                    # Overall state
.install-state.d/                # Per-step states
├── phase1-update_system          # Timestamp
├── phase1-install_docker
├── phase2-create_env_files
└── ...
```

### Skip Completed Steps
```bash
# First run - executes
sudo bash src/install.sh all
# Output: "Installing Docker..."

# Second run - skips
sudo bash src/install.sh all
# Output: "Docker already installed, skipping..."
```

### Resume Capability
```bash
# If interrupted, resume from last step
sudo bash src/install.sh all --resume
# Output: "Resuming from phase2..."
```

### Force Re-run
```bash
# Re-run even if completed
sudo bash src/install.sh all --force
```

### Dry-run Mode
```bash
# Preview without making changes
sudo bash src/install.sh all --dry-run
# Output: "Would install Docker..."
```

---

## 📋 Commands

### Direct Execution

```bash
# Run all phases
sudo bash src/install.sh all

# Run individual phase
sudo bash src/install.sh phase1
sudo bash src/install.sh phase2
sudo bash src/install.sh phase3

# With options
sudo bash src/install.sh all --force       # Re-run
sudo bash src/install.sh all --resume      # Continue from failure
sudo bash src/install.sh all --dry-run     # Preview only
sudo bash src/install.sh all --reset       # Clear state
sudo bash src/install.sh all --unattended  # No prompts
```

### Via CLI

```bash
# Through hestia CLI
hestia install phase1
hestia install phase2
hestia install phase3
hestia install all
```

---

## 🔧 Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `HESTIA_TARGET` | Installation directory | `/opt/hestia` |
| `HESTIA_SAFE_MODE` | Preserve existing data | `0` |
| `HESTIA_UNATTENDED` | Non-interactive mode | `0` |
| `DEBIAN_FRONTEND` | Package manager UI | `noninteractive` |

---

## 🚀 Usage Examples

### Fresh Installation
```bash
# On fresh Ubuntu server
cd packages/install
sudo bash src/install.sh all

# Interactive wizard will run automatically
```

### Manual Phase-by-Phase
```bash
# Step-by-step with verification
sudo bash src/install.sh phase1
# Check logs, verify Docker running

sudo bash src/install.sh phase2
# Check Synap Backend accessible

sudo bash src/install.sh phase3
# Test AI provider
```

### Recovery
```bash
# System broken, re-run phase2
sudo bash src/install.sh phase2 --force

# Resume after network failure
sudo bash src/install.sh all --resume
```

### Unattended Installation
```bash
# For automation/scripts
export HESTIA_UNATTENDED=1
sudo bash src/install.sh all
```

---

## 🔌 Integration Points

### Called By
1. **USB Installer** - During OS installation
2. **hestia init** - First-fire wizard
3. **hestia install** - CLI command
4. **Recovery tools** - System repair

### Calls To
1. **Package managers** - apt/dnf
2. **Docker** - Service management
3. **systemd** - Service control
4. **Network tools** - curl, wget

### State Files
- `.install-state` - Progress tracking
- `/opt/hestia/.env` - Environment variables
- `/opt/hestia/docker-compose.yml` - Service orchestration

---

## 📊 Installation Flow

```
User runs: install.sh all
                │
                ▼
    ┌───────────────────────┐
    │ Check prerequisites   │
    │ - Root access         │
    │ - Internet            │
    │ - Disk space          │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ Phase 1: Foundation   │
    │ (skips if done)       │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ Phase 2: Core         │
    │ (skips if done)       │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ Phase 3: Builder      │
    │ (skips if done)       │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ first-fire.sh         │
    │ (if interactive)      │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ Installation Complete │
    └───────────────────────┘
```

---

## 🛡️ Safety Features

### Data Preservation
- `--safe-mode` flag preserves existing data
- Backups created before destructive operations
- Rollback points at each phase

### Confirmation Prompts
- Destructive operations require confirmation
- Disk formatting shows warning
- Service restart confirms

### Error Handling
- Each step has error checking
- Failed steps don't block others
- Detailed logging to `/var/log/hestia/`

---

## 📈 Troubleshooting

### Common Issues

**Issue:** Docker not starting
```bash
# Check logs
sudo journalctl -u docker

# Re-run phase1
sudo bash src/install.sh phase1 --force
```

**Issue:** Phase interrupted
```bash
# Resume
sudo bash src/install.sh all --resume
```

**Issue:** Want to start fresh
```bash
# Reset state
sudo bash src/install.sh all --reset
sudo bash src/install.sh all
```

### Log Locations
- **Install logs:** `/var/log/hestia/install.log`
- **Service logs:** `/var/log/hestia/services/`
- **System logs:** `/var/log/syslog`

---

## 🔗 Related Packages

- **@hestia/core** - Management CLI
- **@hestia/usb** - USB creation tools

---

## 📚 More Documentation

- [Architecture Overview](../../ARCHITECTURE.md)
- [Complete System Guide](../../COMPLETE-SYSTEM.md)
- [Production Ready](../../PRODUCTION-READY.md)

---

**Status:** Production Ready ✅  
**Version:** 2.0.0  
**License:** MIT
