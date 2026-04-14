#!/bin/bash
# eve USB Creation Tool
# Creates a bootable USB drive with Ventoy and eve installer

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[USB]${NC} $1"; }
log_success() { echo -e "${GREEN}[USB]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[USB]${NC} $1"; }
log_error() { echo -e "${RED}[USB]${NC} $1"; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENTOY_VERSION="1.0.97"
UBUNTU_VERSION="24.04"
UBUNTU_ISO="ubuntu-${UBUNTU_VERSION}-live-server-amd64.iso"
UBUNTU_URL="https://releases.ubuntu.com/${UBUNTU_VERSION}/${UBUNTU_ISO}"

show_header() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║              eve USB Creation Tool                         ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check for root
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi
    
    # Check for required tools
    local required="curl wget tar parted mkfs.vfat mkfs.ext4"
    for tool in $required; do
        if ! command -v $tool &> /dev/null; then
            log_error "Required tool not found: $tool"
            exit 1
        fi
    done
    
    log_success "Prerequisites met"
}

# List available USB devices
list_usb_devices() {
    log_info "Detecting USB devices..."
    
    echo ""
    echo "Available USB devices:"
    echo "─────────────────────────────────────────────────────────────"
    
    lsblk -d -o NAME,SIZE,TYPE,MODEL | grep -E "^(NAME|sd[a-z])" || true
    
    echo ""
    log_warn "WARNING: This will DESTROY ALL DATA on the selected device!"
    log_warn "Make sure you select the correct device."
    echo ""
}

# Select USB device
select_device() {
    list_usb_devices
    
    read -p "Enter the device name (e.g., sdb): " device
    device_path="/dev/${device}"
    
    if [[ ! -b "$device_path" ]]; then
        log_error "Device not found: $device_path"
        exit 1
    fi
    
    # Verify it's a USB device
    if [[ ! -L "/sys/block/${device}" ]] || [[ ! $(readlink -f "/sys/block/${device}") == *usb* ]]; then
        log_warn "This doesn't appear to be a USB device. Proceed with caution!"
        read -p "Continue anyway? (yes/no): " confirm
        if [[ "$confirm" != "yes" ]]; then
            exit 1
        fi
    fi
    
    # Double check
    echo ""
    log_warn "You are about to format: $device_path"
    log_warn "All data on this device will be LOST!"
    echo ""
    read -p "Type 'DESTROY' to confirm: " confirm
    
    if [[ "$confirm" != "DESTROY" ]]; then
        log_info "Cancelled"
        exit 1
    fi
    
    echo "$device_path"
}

# Download Ventoy
download_ventoy() {
    local ventoy_dir="$1"
    
    log_info "Downloading Ventoy..."
    
    mkdir -p "$ventoy_dir"
    cd "$ventoy_dir"
    
    local ventoy_file="ventoy-${VENTOY_VERSION}-linux.tar.gz"
    local ventoy_url="https://github.com/ventoy/Ventoy/releases/download/v${VENTOY_VERSION}/${ventoy_file}"
    
    if [[ ! -f "$ventoy_file" ]]; then
        log_info "Downloading from: $ventoy_url"
        curl -L -o "$ventoy_file" "$ventoy_url"
    else
        log_info "Ventoy already downloaded"
    fi
    
    # Extract
    if [[ ! -d "ventoy-${VENTOY_VERSION}" ]]; then
        tar -xzf "$ventoy_file"
    fi
    
    echo "$ventoy_dir/ventoy-${VENTOY_VERSION}"
}

# Install Ventoy to USB
install_ventoy() {
    local device="$1"
    local ventoy_dir="$2"
    
    log_info "Installing Ventoy to $device..."
    
    # Unmount all partitions
    umount "${device}"* 2>/dev/null || true
    
    # Run Ventoy installer
    cd "$ventoy_dir"
    ./Ventoy2Disk.sh -i "$device"
    
    log_success "Ventoy installed"
}

# Download Ubuntu ISO
download_ubuntu() {
    local iso_dir="$1"
    
    log_info "Downloading Ubuntu Server ISO..."
    
    mkdir -p "$iso_dir"
    
    if [[ ! -f "$iso_dir/$UBUNTU_ISO" ]]; then
        log_info "Downloading from: $UBUNTU_URL"
        curl -L -o "$iso_dir/$UBUNTU_ISO" "$UBUNTU_URL"
    else
        log_info "Ubuntu ISO already downloaded"
    fi
    
    # Verify checksum (optional)
    if [[ -f "$iso_dir/SHA256SUMS" ]]; then
        log_info "Verifying ISO checksum..."
        cd "$iso_dir"
        sha256sum -c SHA256SUMS 2>/dev/null | grep "$UBUNTU_ISO" || log_warn "Checksum verification failed"
    fi
    
    echo "$iso_dir/$UBUNTU_ISO"
}

# Copy files to USB
copy_files() {
    local mount_point="$1"
    local iso_path="$2"
    
    log_info "Copying files to USB..."
    
    # Mount the Ventoy partition
    mkdir -p "$mount_point"
    
    # Find the Ventoy partition (usually has a label)
    local ventoy_part
    ventoy_part=$(lsblk -o NAME,LABEL -n | grep -i ventoy | head -1 | awk '{print "/dev/" $1}')
    
    if [[ -z "$ventoy_part" ]]; then
        # Try to find the first partition of the device
        local device="${device_path%[0-9]*}"
        ventoy_part="${device}1"
    fi
    
    mount "$ventoy_part" "$mount_point"
    
    # Copy Ubuntu ISO
    log_info "Copying Ubuntu ISO..."
    cp "$iso_path" "$mount_point/"
    
    # Copy Ventoy configuration
    log_info "Copying Ventoy configuration..."
    mkdir -p "$mount_point/ventoy"
    cp "$SCRIPT_DIR/../ventoy/ventoy.json" "$mount_point/ventoy/" 2>/dev/null || {
        log_warn "ventoy.json not found, using defaults"
    }
    
    # Copy autoinstall configs
    mkdir -p "$mount_point/ventoy/autoinstall"
    cp "$SCRIPT_DIR/../ventoy/autoinstall/"*.yaml "$mount_point/ventoy/autoinstall/" 2>/dev/null || {
        log_warn "Autoinstall configs not found"
    }
    
    # Copy eve installer
    mkdir -p "$mount_point/eve"
    cp -r "${SCRIPT_DIR}/../../install/src/"* "$mount_point/eve/" 2>/dev/null || {
        log_warn "eve installer not found at expected location"
    }
    
    # Create late-command script
    cat > "$mount_point/ventoy/autoinstall/late-command.sh" << 'EOF'
#!/bin/bash
# Late command run after Ubuntu installation

eve_TARGET="/opt/eve"

# Update package list
apt-get update

# Install prerequisites
apt-get install -y curl wget git

# Run eve installer Phase 1
if [[ -d "${eve_TARGET}/eve" ]]; then
    bash "${eve_TARGET}/eve/install.sh" phase1
fi
EOF
    
    chmod +x "$mount_point/ventoy/autoinstall/late-command.sh"
    
    # Create README
    cat > "$mount_point/eve-README.txt" << 'EOF'
eve - Sovereign AI Infrastructure
═══════════════════════════════════════

This USB contains the eve installer for Ubuntu Server.

Boot Options:
1. Safe Install - Interactive Ubuntu setup with eve
2. Unattended Install - Automatic installation (DESTROYS ALL DATA)

After Installation:
1. Remove USB and reboot
2. Run: sudo /opt/eve/eve/bin/eve init
3. Follow the first-fire wizard

For help: https://docs.eve.dev
Community: https://community.eve.dev
EOF
    
    # Unmount
    umount "$mount_point"
    rmdir "$mount_point" 2>/dev/null || true
    
    log_success "Files copied to USB"
}

# Main function
main() {
    show_header
    
    check_prerequisites
    
    # Select device
    device_path=$(select_device)
    
    # Create working directory
    work_dir="/tmp/eve-usb-$$"
    mkdir -p "$work_dir"
    
    log_info "Working directory: $work_dir"
    
    # Download components
    ventoy_dir=$(download_ventoy "$work_dir/ventoy")
    iso_path=$(download_ubuntu "$work_dir/iso")
    
    # Install Ventoy
    install_ventoy "$device_path" "$ventoy_dir"
    
    # Copy files
    copy_files "$work_dir/mnt" "$iso_path"
    
    # Cleanup
    log_info "Cleaning up..."
    rm -rf "$work_dir"
    
    # Sync
    sync
    
    log_success "═══════════════════════════════════════"
    log_success "USB Creation Complete!"
    log_success "═══════════════════════════════════════"
    log_info "Device: $device_path"
    log_info "You can now boot from this USB to install eve"
    log_info ""
    log_info "Boot menu options:"
    log_info "  1. Safe Install - Interactive with eve"
    log_info "  2. Wipe Install - Automatic (DESTROYS DATA)"
    log_info ""
    log_warn "Safely eject the USB before removing"
}

# Handle arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --no-download    Use cached files only"
        echo "  --device <dev>   Specify device (e.g., /dev/sdb)"
        echo "  --help           Show this help"
        echo ""
        echo "This tool creates a bootable USB with:"
        echo "  - Ventoy bootloader"
        echo "  - Ubuntu Server LTS"
        echo "  - eve installer"
        echo ""
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac
