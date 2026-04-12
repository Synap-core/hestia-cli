#!/bin/bash
# Phase 1: Foundation
# - Update system packages
# - Install Docker and Docker Compose
# - Configure UFW firewall
# - Harden SSH access
# - Create hestia user
#
# Idempotent: Safe to run multiple times

set -euo pipefail

HESTIA_TARGET="${HESTIA_TARGET:-/opt/hestia}"
HESTIA_SAFE_MODE="${HESTIA_SAFE_MODE:-0}"

# State tracking (inherited from main script or use defaults)
INSTALL_STATE_FILE="${INSTALL_STATE_FILE:-${HESTIA_TARGET}/.install-state}"
INSTALL_STATE_DIR="${INSTALL_STATE_DIR:-${HESTIA_TARGET}/.install-state.d/phase1}"
FORCE_MODE="${FORCE_MODE:-false}"
DRY_RUN_MODE="${DRY_RUN_MODE:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Logging functions
log_info() { echo -e "${BLUE}[PHASE1]${NC} $1"; }
log_success() { echo -e "${GREEN}[PHASE1]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[PHASE1]${NC} $1"; }
log_error() { echo -e "${RED}[PHASE1]${NC} $1"; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }
log_skip() { echo -e "${YELLOW}[SKIP]${NC} $1"; }
log_dryrun() { echo -e "${CYAN}[DRY-RUN]${NC} $1"; }

# ============================================================================
# STATE MANAGEMENT
# ============================================================================

init_state() {
    mkdir -p "$INSTALL_STATE_DIR"
}

check_step_completed() {
    local step_name="$1"
    local state_file="$INSTALL_STATE_DIR/$step_name"
    
    if [[ "$FORCE_MODE" == true ]]; then
        return 1
    fi
    
    [[ -f "$state_file" ]]
}

mark_step_completed() {
    local step_name="$1"
    local state_file="$INSTALL_STATE_DIR/$step_name"
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would mark complete: $step_name"
        return 0
    fi
    
    echo "completed=$(date -Iseconds)" > "$state_file"
    log_success "Completed: $step_name"
}

should_run_step() {
    local step_name="$1"
    
    if [[ "$FORCE_MODE" == true ]]; then
        log_step "Force mode - running: $step_name"
        return 0
    fi
    
    if check_step_completed "$step_name"; then
        log_skip "Already completed: $step_name"
        return 1
    fi
    
    log_step "Running: $step_name"
    return 0
}

show_progress() {
    local completed=$(find "$INSTALL_STATE_DIR" -type f 2>/dev/null | wc -l)
    local total=7  # Total number of steps in phase1
    
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BLUE}  Phase 1 Progress: $completed/$total steps${NC}"
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
}

# ============================================================================
# IDEMPOTENT STEP FUNCTIONS
# ============================================================================

# Update system packages
update_system() {
    local step_name="update_system"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would update system packages"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Updating system packages..."
    
    export DEBIAN_FRONTEND=noninteractive
    
    apt-get update
    
    # Check if there are packages to upgrade (idempotent check)
    local upgrades=$(apt-get --just-print upgrade 2>/dev/null | grep -c "^Inst" || echo "0")
    if [[ "$upgrades" -eq 0 ]]; then
        log_info "System already up to date"
    else
        apt-get upgrade -y
        log_success "System packages updated ($upgrades packages)"
    fi
    
    # Install required packages (idempotent - won't reinstall if present)
    local packages=(
        curl wget git vim htop net-tools
        ca-certificates gnupg lsb-release
        software-properties-common apt-transport-https
        ufw fail2ban
    )
    
    local packages_to_install=()
    for pkg in "${packages[@]}"; do
        if ! dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
            packages_to_install+=("$pkg")
        fi
    done
    
    if [[ ${#packages_to_install[@]} -gt 0 ]]; then
        apt-get install -y "${packages_to_install[@]}"
        log_success "Installed ${#packages_to_install[@]} packages"
    else
        log_info "All required packages already installed"
    fi
    
    mark_step_completed "$step_name"
}

# Install Docker
install_docker() {
    local step_name="install_docker"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would install Docker and Docker Compose"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Checking Docker installation..."
    
    # Check if Docker is already installed and running
    if command -v docker &> /dev/null && docker version &> /dev/null; then
        log_info "Docker already installed and running"
        
        # Check Docker Compose plugin
        if docker compose version &> /dev/null; then
            log_info "Docker Compose plugin already installed"
            mark_step_completed "$step_name"
            return 0
        fi
    fi
    
    log_info "Installing Docker..."
    
    # Remove old versions (idempotent - won't fail if not present)
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    # Add Docker's official GPG key (idempotent - overwrite if exists)
    mkdir -p /etc/apt/keyrings
    if [[ -f /etc/apt/keyrings/docker.gpg ]]; then
        log_info "Docker GPG key already present, updating..."
    fi
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Set up repository (idempotent - overwrite if exists)
    local arch=$(dpkg --print-architecture)
    local codename=$(lsb_release -cs)
    local repo_entry="deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable"
    
    if [[ -f /etc/apt/sources.list.d/docker.list ]]; then
        if grep -q "$repo_entry" /etc/apt/sources.list.d/docker.list 2>/dev/null; then
            log_info "Docker repository already configured"
        else
            echo "$repo_entry" > /etc/apt/sources.list.d/docker.list
        fi
    else
        echo "$repo_entry" > /etc/apt/sources.list.d/docker.list
    fi
    
    # Install Docker (idempotent - apt-get handles versions)
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Start and enable Docker (idempotent)
    systemctl start docker 2>/dev/null || true
    systemctl enable docker
    
    log_success "Docker installed and running"
    mark_step_completed "$step_name"
}

# Configure firewall
configure_firewall() {
    local step_name="configure_firewall"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would configure UFW firewall"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Configuring UFW firewall..."
    
    # Check if UFW is installed
    if ! command -v ufw &> /dev/null; then
        log_warn "UFW not found, installing..."
        apt-get install -y ufw
    fi
    
    # Check if firewall is already configured correctly
    if ufw status | grep -q "Status: active"; then
        log_info "Firewall already active, checking rules..."
        
        # Check if required rules exist
        local needs_update=false
        if ! ufw status | grep -q "3000/tcp"; then
            needs_update=true
        fi
        
        if [[ "$needs_update" == false ]]; then
            log_info "Firewall rules already configured"
            mark_step_completed "$step_name"
            return 0
        fi
        
        log_info "Updating existing firewall configuration..."
    fi
    
    # Reset UFW to default (only if safe mode is off)
    if [[ "$HESTIA_SAFE_MODE" != "1" ]]; then
        ufw --force reset 2>/dev/null || true
    fi
    
    # Default policies
    ufw default deny incoming
    ufw default allow outgoing
    
    # Allow SSH (rate limited) - idempotent
    if ! ufw status | grep -q "22/tcp"; then
        ufw limit 22/tcp comment 'SSH'
    fi
    
    # Allow HTTP/HTTPS - idempotent
    if ! ufw status | grep -q "80/tcp"; then
        ufw allow 80/tcp comment 'HTTP'
    fi
    if ! ufw status | grep -q "443/tcp"; then
        ufw allow 443/tcp comment 'HTTPS'
    fi
    
    # Allow Hestia services - idempotent
    local hestia_ports=(
        "3000/tcp:Synap Frontend"
        "4000/tcp:Synap Backend"
        "3001/tcp:Intelligence Hub"
        "5173/tcp:Admin Dashboard"
    )
    
    for port_entry in "${hestia_ports[@]}"; do
        IFS=':' read -r port comment <<< "$port_entry"
        if ! ufw status | grep -q "${port}"; then
            ufw allow "$port" comment "$comment"
        fi
    done
    
    # Enable UFW (idempotent)
    ufw --force enable
    
    log_success "Firewall configured"
    mark_step_completed "$step_name"
}

# Harden SSH
harden_ssh() {
    local step_name="harden_ssh"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would harden SSH configuration"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Hardening SSH access..."
    
    local ssh_config="/etc/ssh/sshd_config"
    
    if [[ ! -f "$ssh_config" ]]; then
        log_warn "SSH config not found at $ssh_config, skipping"
        mark_step_completed "$step_name"
        return 0
    fi
    
    # Backup original (only once - idempotent)
    if [[ ! -f "${ssh_config}.backup" ]]; then
        cp "$ssh_config" "${ssh_config}.backup"
        log_info "Created SSH config backup"
    fi
    
    # Track if changes were made
    local changes_made=false
    
    # Disable root login (idempotent)
    if grep -q "^#*PermitRootLogin yes" "$ssh_config" 2>/dev/null; then
        sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' "$ssh_config"
        log_info "Disabled root login"
        changes_made=true
    elif ! grep -q "^PermitRootLogin no" "$ssh_config" 2>/dev/null; then
        # Add if not present at all
        echo "PermitRootLogin no" >> "$ssh_config"
        changes_made=true
    fi
    
    # Limit authentication attempts (idempotent)
    if ! grep -q "^MaxAuthTries 3" "$ssh_config" 2>/dev/null; then
        sed -i 's/^#*MaxAuthTries.*/MaxAuthTries 3/' "$ssh_config"
        # Add if not present
        if ! grep -q "^MaxAuthTries" "$ssh_config" 2>/dev/null; then
            echo "MaxAuthTries 3" >> "$ssh_config"
        fi
        log_info "Set MaxAuthTries to 3"
        changes_made=true
    fi
    
    # Only restart SSH if changes were made
    if [[ "$changes_made" == true ]]; then
        if sshd -t 2>/dev/null; then
            systemctl restart sshd
            log_success "SSH hardened and restarted"
        else
            log_warn "SSH config test failed, not restarting"
        fi
    else
        log_info "SSH already properly configured"
    fi
    
    mark_step_completed "$step_name"
}

# Create hestia user
create_user() {
    local step_name="create_user"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create hestia user"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Setting up hestia user..."
    
    # Check if user already exists
    if id "hestia" &>/dev/null; then
        log_info "User 'hestia' already exists"
        
        # Ensure user is in docker group
        if ! groups hestia | grep -q docker; then
            usermod -aG docker hestia
            log_info "Added hestia to docker group"
        fi
        
        # Ensure home directory exists
        if [[ ! -d "$HESTIA_TARGET/home" ]]; then
            mkdir -p "$HESTIA_TARGET/home"
            chown hestia:hestia "$HESTIA_TARGET/home"
        fi
        
        mark_step_completed "$step_name"
        return 0
    fi
    
    # Create user with home directory
    useradd -m -s /bin/bash -d "$HESTIA_TARGET/home" hestia
    
    # Add to docker group
    usermod -aG docker hestia
    
    # Set up .ssh directory
    mkdir -p "$HESTIA_TARGET/home/.ssh"
    chmod 700 "$HESTIA_TARGET/home/.ssh"
    chown -R hestia:hestia "$HESTIA_TARGET/home"
    
    log_success "User 'hestia' created"
    mark_step_completed "$step_name"
}

# Configure fail2ban
configure_fail2ban() {
    local step_name="configure_fail2ban"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would configure fail2ban"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Configuring fail2ban..."
    
    # Check if jail.local already exists and is correct
    if [[ -f /etc/fail2ban/jail.local ]]; then
        if grep -q "Hestia" /etc/fail2ban/jail.local 2>/dev/null; then
            log_info "Fail2ban already configured for Hestia"
            
            # Ensure service is running
            systemctl enable fail2ban 2>/dev/null || true
            systemctl restart fail2ban 2>/dev/null || true
            
            mark_step_completed "$step_name"
            return 0
        fi
    fi
    
    # Create jail.local
    cat > /etc/fail2ban/jail.local << 'EOF'
# Hestia fail2ban configuration
# Auto-generated - safe to re-run

[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3

[docker-compose]
enabled = true
filter = docker-compose
port = all
protocol = tcp
logpath = /var/log/docker-compose.log
maxretry = 5
EOF
    
    # Enable and start fail2ban (idempotent)
    systemctl enable fail2ban 2>/dev/null || true
    systemctl restart fail2ban 2>/dev/null || true
    
    log_success "Fail2ban configured"
    mark_step_completed "$step_name"
}

# Create systemd service for Hestia
create_systemd_service() {
    local step_name="create_systemd_service"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create Hestia systemd service"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Creating Hestia systemd service..."
    
    local service_file="/etc/systemd/system/hestia.service"
    
    # Check if service file exists and is correct
    if [[ -f "$service_file" ]]; then
        if grep -q "$HESTIA_TARGET" "$service_file" 2>/dev/null; then
            log_info "Systemd service already exists and is correct"
            
            # Ensure enabled
            systemctl daemon-reload 2>/dev/null || true
            systemctl enable hestia.service 2>/dev/null || true
            
            mark_step_completed "$step_name"
            return 0
        fi
    fi
    
    # Create/overwrite service file
    cat > "$service_file" << EOF
# Hestia Systemd Service
# Auto-generated - safe to re-run

[Unit]
Description=Hestia - Sovereign AI Infrastructure
Documentation=https://docs.hestia.dev
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=hestia
Group=hestia
WorkingDirectory=$HESTIA_TARGET
Environment=HESTIA_HOME=$HESTIA_TARGET
ExecStart=$HESTIA_TARGET/bin/hestia ignite
ExecStop=$HESTIA_TARGET/bin/hestia extinguish
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload 2>/dev/null || true
    systemctl enable hestia.service 2>/dev/null || true
    
    log_success "Systemd service created"
    mark_step_completed "$step_name"
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    init_state
    
    log_info "═══════════════════════════════════════"
    log_info "Phase 1: Foundation"
    log_info "═══════════════════════════════════════"
    
    # Show progress at start
    show_progress
    
    # Run all steps
    update_system
    install_docker
    configure_firewall
    harden_ssh
    create_user
    configure_fail2ban
    create_systemd_service
    
    # Show final progress
    show_progress
    
    log_success "═══════════════════════════════════════"
    log_success "Phase 1 Complete!"
    log_success "═══════════════════════════════════════"
    log_info "System is ready for Phase 2"
    log_info ""
    log_info "To re-run: sudo ./install.sh phase1 --force"
}

main "$@"
