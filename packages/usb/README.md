# @hestia/usb - USB Creation Tools

**Bootable USB generation for Hestia bare-metal installation**

---

## 📋 Package Role

**Purpose:** Create bootable USB keys for Hestia server installation

**Scope:**
- USB device management and selection
- Ubuntu Server ISO handling
- Ventoy bootloader installation
- Cloud-init configuration generation
- Hestia installer injection
- Bootable media verification

**When to Use:**
- Initial server provisioning (bare metal)
- OS reinstallation
- Recovery scenarios
- Multi-server deployment

**Key Characteristic:** Creates fully autonomous installation media

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│       USB Generation Pipeline           │
│                                         │
│  Input: Device + Configuration          │
└──────────────────┬──────────────────────┘
                   │
         ┌─────────┴──────────┐
         │                    │
┌────────▼────────┐   ┌───────▼────────┐
│ Download        │   │ Generate       │
│ Components      │   │ Configurations │
│                 │   │                │
│ - Ubuntu ISO    │   │ - ventoy.json  │
│ - Ventoy        │   │ - safe.yaml    │
└────────┬────────┘   │ - wipe.yaml    │
         │           │ - user-data    │
         │           └───────┬────────┘
         │                   │
         └─────────┬─────────┘
                   │
         ┌─────────▼─────────┐
         │  Install to USB │
         │                 │
         │  1. Format      │
         │  2. Ventoy      │
         │  3. Copy ISO    │
         │  4. Configs     │
         │  5. Installer   │
         └────────┬────────┘
                   │
         ┌─────────▼─────────┐
         │  Verify USB       │
         │  (bootable test)  │
         └───────────────────┘
```

---

## 🛠️ Technologies

### Core Tools
| Technology | Purpose |
|------------|---------|
| **Bash** | Main scripting |
| **Ventoy** | Multi-boot USB bootloader |
| **dd** | Disk imaging |
| **parted/fdisk** | Partition management |

### Download Tools
| Tool | Purpose |
|------|---------|
| **curl/wget** | HTTP downloads |
| **sha256sum** | Checksum verification |

### Configuration
| Technology | Purpose |
|------------|---------|
| **cloud-init** | Ubuntu autoinstall |
| **YAML** | Configuration files |
| **JSON** | Ventoy configuration |

---

## 📁 File Structure

```
packages/usb/
├── package.json               # Package metadata
├── README.md                  # This file
└── src/
    ├── create-usb.sh          # Main USB creation script (5.2 KB)
    │   └── Features:
    │       - Device detection and selection
    │       - ISO download and verification
    │       - Ventoy installation
    │       - Safety checks (system disk detection)
    │       - Progress reporting
    │       - Verification
    │
    └── ventoy/
        ├── ventoy.json       # Boot configuration (1.0 KB)
        │   └── Defines:
        │       - Menu aliases
        │       - Auto-install templates
        │       - Boot options
        │
        └── autoinstall/
            ├── safe.yaml     # Safe install config (3.3 KB)
            │   └── Interactive Ubuntu installation
            │       - User prompts for all settings
            │       - Network configuration
            │       - Manual disk selection
            │       - Post-install Hestia init
            │
            └── wipe.yaml     # Wipe install config (5.4 KB)
                └── Unattended Ubuntu installation
                    - Automatic disk wipe ⚠️
                    - Pre-configured settings
                    - Auto-runs Phase 1
                    - For fresh hardware only
```

---

## 📊 USB Creation Modes

### Safe Install (Interactive)

**Purpose:** Guided installation with user prompts

**Behavior:**
- Boots to Ubuntu installer
- Prompts for disk selection
- Network configuration wizard
- User account setup
- Manual Hestia initialization after reboot

**When to Use:**
- Production systems
- Servers with existing data
- First-time installations
- Complex disk configurations

**Configuration:** `ventoy/autoinstall/safe.yaml`

### Wipe Install (Unattended)

**⚠️ WARNING: DESTROYS ALL DATA ON TARGET DISK**

**Purpose:** Fully automated installation

**Behavior:**
- Automatically detects and wipes first disk
- Uses pre-configured settings
- Runs Phase 1 automatically
- Reboots to ready system

**When to Use:**
- Fresh hardware
- Testing environments
- Known configurations
- Automated deployments

**Configuration:** `ventoy/autoinstall/wipe.yaml`

---

## 🎯 Key Features

### Safety Features

1. **System Disk Detection**
   - Identifies system/boot disks
   - Shows ⚠️ WARNING in device list
   - Requires explicit confirmation

2. **Confirmation Required**
   - Type "DESTROY /dev/sdX" to proceed
   - Shows what will be formatted
   - Data loss warning

3. **Backup Option**
   - Offers to backup existing data
   - Creates timestamped backup

4. **Verification**
   - Tests USB bootability after creation
   - Verifies all files present

### Automation Features

1. **Auto-Download**
   - Downloads Ubuntu ISO automatically
   - Verifies SHA256 checksum
   - Caches for reuse

2. **Auto-Configure**
   - Generates configs based on inputs
   - Hearth name, AI provider, network

3. **Progress Tracking**
   - Shows progress for each step
   - ETA calculation
   - Detailed logging

---

## 📋 Commands

### Direct Execution

```bash
# Interactive mode
cd packages/usb
sudo bash src/create-usb.sh

# With options
sudo bash src/create-usb.sh --device /dev/sdb
sudo bash src/create-usb.sh --device /dev/sdb --mode safe
```

### Via CLI (recommended)

```bash
# Interactive wizard
hestia usb

# List devices
hestia usb:list

# Create USB
hestia usb:create --device /dev/sdb --mode safe

# With full configuration
hestia usb:create \
  --device /dev/sdb \
  --mode safe \
  --hearth-name "my-server" \
  --ai-provider ollama \
  --ai-model llama3.2

# Verify after creation
hestia usb:verify --device /dev/sdb

# Benchmark USB speed
hestia usb:benchmark --device /dev/sdb
```

---

## 🔄 USB Creation Process

### Step 1: Device Selection
```bash
# List available USB devices
hestia usb:list

# Output:
USB Devices:
NAME   MODEL          SIZE      MOUNTED  SYSTEM?
─────────────────────────────────────────────────
sdb    SanDisk Ultra  64GB      No       ✗
sdc    Kingston DT    128GB     No       ✗
sda    Samsung SSD    500GB     Yes      ⚠️ SYSTEM DISK
```

### Step 2: Configuration
```bash
# Interactive prompts for:
# - Installation mode (safe/wipe)
# - Hearth name
# - AI provider (Ollama/OpenRouter/Anthropic/OpenAI)
# - AI model
# - Network settings (optional)
```

### Step 3: Component Download
```
✓ Ubuntu Server 24.04 ISO (2.1 GB)
✓ Ventoy 1.0.97 (15 MB)
✓ SHA256 checksums verified
```

### Step 4: USB Creation
```
1. Format USB device
2. Install Ventoy bootloader
3. Copy Ubuntu ISO
4. Copy Ventoy configuration
5. Copy autoinstall configs
6. Copy Hestia installer
7. Verify bootability
```

### Step 5: Verification
```bash
✓ USB is bootable
✓ All files present
✓ Bootloader configured
✓ Ready for installation
```

---

## 📦 What Gets Installed

### On USB Drive
```
/ (USB Root)
├── ventoy/                    # Ventoy configuration
│   ├── ventoy.json           # Boot menu
│   └── autoinstall/
│       ├── safe.yaml         # Interactive config
│       └── wipe.yaml         # Unattended config
│
├── ubuntu-24.04-server-amd64.iso  # Ubuntu ISO
├── hestia/                   # Hestia installer
│   ├── install.sh
│   ├── phases/
│   └── wizard/
└── ventoy/                   # Ventoy bootloader files
```

### On Target Server (After Boot)
```
/opt/hestia/                  # Installation directory
├── config/                   # Configuration files
├── data/                     # Data storage
├── packages/                 # Installed packages
├── logs/                     # Log files
└── docker-compose.yml        # Service orchestration
```

---

## 🔌 Integration Points

### Called By
1. **hestia provision:usb** - Server-specific USB creation
2. **hestia usb** - General USB creation
3. **Manual execution** - Direct script usage

### Calls To
1. **lsblk/blkid** - Device detection
2. **curl/wget** - Downloads
3. **dd** - Disk imaging
4. **ventoy** - Bootloader installation

### Uses From
1. **@hestia/install** - Installer scripts copied to USB
2. **@hestia/core** - USB generator service

---

## 🚀 Usage Examples

### Basic USB Creation
```bash
# Interactive wizard
hestia usb

# Follow prompts to select device and configure
```

### Production Server USB
```bash
# Create for specific server
hestia usb:create \
  --device /dev/sdb \
  --mode safe \
  --hearth-name "prod-ai-server-01" \
  --ai-provider ollama \
  --ai-model llama3.2
```

### Testing/Development USB
```bash
# Wipe mode for testing
hestia usb:create \
  --device /dev/sdb \
  --mode wipe \
  --hearth-name "test-server" \
  --ai-provider ollama

# ⚠️ Warning: Will destroy all data on target!
```

### Multiple USBs for Cluster
```bash
# Create USBs for cluster nodes
for i in 1 2 3; do
  hestia usb:create \
    --device /dev/sdb \
    --hearth-name "cluster-node-$i" \
    --ai-provider ollama
done
```

### Dry Run (Preview)
```bash
# See what would be done
hestia usb:create --device /dev/sdb --dry-run
```

---

## 🔧 Configuration Generation

### Generate Configs Only (No USB)
```bash
# Generate configuration files
hestia usb:config \
  --mode safe \
  --output ./my-configs/

# Creates:
# ./my-configs/ventoy.json
# ./my-configs/safe.yaml
# ./my-configs/wipe.yaml
# ./my-configs/user-data
```

### Custom Configurations

**ventoy.json** - Boot menu configuration
```json
{
  "control": [
    {
      "VTOY_DEFAULT_MENU_MODE": "0",
      "VTOY_MENU_TIMEOUT": "10"
    }
  ],
  "auto_install": [
    {
      "image": "/ubuntu-24.04-server-amd64.iso",
      "template": [
        "/ventoy/autoinstall/safe.yaml",
        "/ventoy/autoinstall/wipe.yaml"
      ]
    }
  ]
}
```

**safe.yaml** - Interactive Ubuntu install
```yaml
autoinstall:
  version: 1
  interactive-sections:
    - network
    - storage
    - identity
  # ... more config
```

---

## 📈 Requirements

### Host System (Where USB is Created)
- **OS:** Linux (Ubuntu/Debian recommended)
- **Access:** Root/sudo
- **Disk Space:** 4GB free (for ISO cache)
- **Tools:** curl, parted, tar

### Target USB Drive
- **Capacity:** 8GB minimum, 16GB recommended
- **Type:** USB 3.0+ recommended (faster install)
- **Quality:** Name-brand recommended (reliability)

### Target Server (Where USB is Used)
- **Architecture:** x86_64 or arm64
- **RAM:** 4GB minimum, 8GB recommended
- **Storage:** 50GB minimum
- **Network:** Internet connection (for downloads)

---

## 🛡️ Safety & Security

### Data Protection
- **System Disk Detection:** Prevents formatting OS drive
- **Confirmation Required:** Type "DESTROY" to proceed
- **Backup Option:** Can backup existing data
- **Verification:** Tests bootability after creation

### Boot Security
- **UEFI/BIOS Support:** Both boot modes
- **Secure Boot:** May need to disable on some systems
- **Signed Bootloader:** Ventoy is signed where possible

### Installation Security
- **SSH Hardening:** Automatic in Phase 1
- **Firewall:** UFW configured automatically
- **No Default Passwords:** User must set passwords
- **Key-based Auth:** SSH keys recommended

---

## 🐛 Troubleshooting

### USB Not Booting
```bash
# 1. Verify USB
hestia usb:verify --device /dev/sdb

# 2. Check BIOS/UEFI settings
# - Enable USB boot
# - Disable Secure Boot (if needed)
# - Set USB as first boot device

# 3. Try different USB port
# - USB 2.0 ports sometimes more compatible
# - Rear ports often more reliable
```

### Slow Creation
```bash
# Benchmark USB first
hestia usb:benchmark --device /dev/sdb

# USB 2.0: ~20-30 minutes
# USB 3.0: ~5-10 minutes
```

### ISO Download Fails
```bash
# Manual download
curl -L -o ~/.hestia/usb-cache/ubuntu-24.04.iso \
  https://releases.ubuntu.com/24.04/ubuntu-24.04-live-server-amd64.iso

# Then create USB (will use cached ISO)
hestia usb:create --device /dev/sdb
```

---

## 📚 Related Documentation

- [Architecture Overview](../../ARCHITECTURE.md)
- [Complete System Guide](../../COMPLETE-SYSTEM.md)
- [Production Ready](../../PRODUCTION-READY.md)

---

## 🔗 Related Packages

- **@hestia/core** - Management CLI (includes USB commands)
- **@hestia/install** - Installer scripts (copied to USB)

---

**Status:** Production Ready ✅  
**Version:** 2.0.0  
**License:** MIT
