#!/bin/bash
# Main Hestia Installer
# Usage: ./install.sh [phase1|phase2|phase3|all] [--force] [--resume] [--dry-run] [--reset]
# Environment variables:
#   HESTIA_TARGET - Installation directory (default: /opt/hestia)
#   HESTIA_SAFE_MODE - Preserve existing data (default: false)
#   HESTIA_UNATTENDED - No prompts (default: false)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
HESTIA_TARGET="${HESTIA_TARGET:-/opt/hestia}"
HESTIA_SAFE_MODE="${HESTIA_SAFE_MODE:-0}"
HESTIA_UNATTENDED="${HESTIA_UNATTENDED:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# State file location
INSTALL_STATE_FILE="${HESTIA_TARGET}/.install-state"
INSTALL_STATE_DIR="${HESTIA_TARGET}/.install-state.d"

# Command-line flags
FORCE_MODE=false
RESUME_MODE=false
DRY_RUN_MODE=false
RESET_MODE=false
WITH_SERVICES=""

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

log_skip() {
    echo -e "${YELLOW}[SKIP]${NC} $1"
}

log_dryrun() {
    echo -e "${CYAN}[DRY-RUN]${NC} $1"
}

# ============================================================================
# STATE MANAGEMENT
# ============================================================================

# Initialize state tracking
init_state() {
    mkdir -p "$INSTALL_STATE_DIR"
    if [[ ! -f "$INSTALL_STATE_FILE" ]]; then
        echo "# Hestia Installation State" > "$INSTALL_STATE_FILE"
        echo "# Created: $(date -Iseconds)" >> "$INSTALL_STATE_FILE"
        echo "INSTALL_VERSION=1.0" >> "$INSTALL_STATE_FILE"
        echo "INSTALL_STARTED=$(date +%s)" >> "$INSTALL_STATE_FILE"
    fi
}

# Check if a step is completed
check_step_completed() {
    local step_name="$1"
    local state_file="$INSTALL_STATE_DIR/$step_name"
    
    if [[ "$FORCE_MODE" == true ]]; then
        return 1  # Force mode - step not considered complete
    fi
    
    if [[ -f "$state_file" ]]; then
        return 0  # Step completed
    fi
    
    return 1  # Step not completed
}

# Mark a step as completed
mark_step_completed() {
    local step_name="$1"
    local state_file="$INSTALL_STATE_DIR/$step_name"
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would mark step as completed: $step_name"
        return 0
    fi
    
    echo "completed=$(date -Iseconds)" > "$state_file"
    echo "pid=$$" >> "$state_file"
    log_success "Step completed: $step_name"
}

# Check if should run a step
should_run_step() {
    local step_name="$1"
    
    if [[ "$FORCE_MODE" == true ]]; then
        log_step "Force mode - will run: $step_name"
        return 0
    fi
    
    if check_step_completed "$step_name"; then
        log_skip "Already completed: $step_name"
        return 1
    fi
    
    log_step "Running: $step_name"
    return 0
}

# Show progress overview
show_progress() {
    local phase="$1"
    local total_steps="$2"
    local completed=0
    
    if [[ -d "$INSTALL_STATE_DIR" ]]; then
        completed=$(find "$INSTALL_STATE_DIR" -type f -name '*' 2>/dev/null | wc -l)
    fi
    
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC} ${CYAN}Installation Progress${NC}                                          ${BLUE}║${NC}"
    echo -e "${BLUE}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║${NC} Phase: $phase" | awk '{printf "%-71s║\n", $0}'
    echo -e "${BLUE}║${NC} Steps completed: $completed / $total_steps" | awk '{printf "%-71s║\n", $0}'
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
}

# Show detailed progress for all phases
show_full_progress() {
    echo -e "\n${CYAN}=== Installation State ===${NC}"
    
    if [[ ! -d "$INSTALL_STATE_DIR" ]]; then
        echo "No installation state found."
        return 0
    fi
    
    echo -e "\n${CYAN}Completed Steps:${NC}"
    for state_file in "$INSTALL_STATE_DIR"/*; do
        if [[ -f "$state_file" ]]; then
            local step_name=$(basename "$state_file")
            local completed_time=$(grep "completed=" "$state_file" 2>/dev/null | cut -d= -f2)
            echo "  ✓ $step_name ($completed_time)"
        fi
    done
    
    echo ""
}

# Reset state (remove all tracking)
reset_state() {
    log_warn "Resetting installation state..."
    
    if [[ -f "$INSTALL_STATE_FILE" ]]; then
        rm -f "$INSTALL_STATE_FILE"
    fi
    
    if [[ -d "$INSTALL_STATE_DIR" ]]; then
        rm -rf "$INSTALL_STATE_DIR"
    fi
    
    init_state
    log_success "State reset complete"
}

# Get last completed phase for resume
get_last_phase() {
    local last_phase=""
    
    if [[ -f "$INSTALL_STATE_FILE" ]]; then
        last_phase=$(grep "LAST_PHASE=" "$INSTALL_STATE_FILE" 2>/dev/null | cut -d= -f2)
    fi
    
    echo "$last_phase"
}

# Set last completed phase
set_last_phase() {
    local phase="$1"
    
    if [[ "$DRY_RUN_MODE" == false ]]; then
        # Remove old LAST_PHASE if exists
        sed -i '/^LAST_PHASE=/d' "$INSTALL_STATE_FILE" 2>/dev/null || true
        echo "LAST_PHASE=$phase" >> "$INSTALL_STATE_FILE"
    fi
}

# ============================================================================
# MAIN FUNCTIONS
# ============================================================================

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --force)
                FORCE_MODE=true
                log_warn "Force mode enabled - will re-run all steps"
                shift
                ;;
            --resume)
                RESUME_MODE=true
                log_info "Resume mode enabled - will continue from last phase"
                shift
                ;;
            --dry-run)
                DRY_RUN_MODE=true
                log_warn "Dry-run mode - showing what would be done"
                shift
                ;;
            --reset)
                RESET_MODE=true
                shift
                ;;
            --with-services)
                WITH_SERVICES="$2"
                shift 2
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            phase1|phase2|phase3|all)
                TARGET_PHASE="$1"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Show help
show_help() {
    cat << 'EOF'
Hestia Installer - Sovereign AI Infrastructure

Usage: ./install.sh [phase] [options]

Phases:
  phase1    - Foundation (system, Docker, firewall)
  phase2    - Core + Gateway (services, databases, reverse proxy)
  phase3    - Builder (OpenClaude, A2A, intelligence)
  all       - Run all phases (default)

Options:
  --force          Re-run all steps even if already completed
  --resume         Continue from where installation left off
  --dry-run        Show what would be done without making changes
  --reset          Reset installation state and start fresh
  --with-services  Enable optional services (comma-separated list)
  --help           Show this help message

Environment Variables:
  HESTIA_TARGET      - Installation directory (default: /opt/hestia)
  HESTIA_SAFE_MODE   - Preserve existing data (default: false)
  HESTIA_UNATTENDED  - No prompts (default: false)

Examples:
  ./install.sh                               # Run all phases
  ./install.sh phase1                        # Run only phase 1
  ./install.sh all --force                   # Re-run all phases
  ./install.sh --resume                      # Continue from last failure
  ./install.sh --dry-run                     # Preview what would be done
  ./install.sh --reset                       # Reset and start fresh
  ./install.sh --with-services=traefik,whodb  # Install with Traefik and WhoDB
  ./install.sh --with-services=lobechat      # Install with LobeChat AI UI

EOF
}

# Header
show_header() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║              HESTIA - Sovereign AI Infrastructure             ║"
    echo "║                                                               ║"
    echo "║              Your data. Your AI. Your infrastructure.           ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Check if running as root
check_root() {
    local step_name="check_root"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would check for root access"
        mark_step_completed "$step_name"
        return 0
    fi
    
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root or with sudo"
        exit 1
    fi
    
    mark_step_completed "$step_name"
}

# Check prerequisites
check_prerequisites() {
    local step_name="check_prerequisites"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would check prerequisites (curl, wget, git, internet)"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Checking prerequisites..."
    
    # Check for required commands
    local required_commands="curl wget git"
    for cmd in $required_commands; do
        if ! command -v $cmd &> /dev/null; then
            log_warn "$cmd not found, will attempt to install"
        fi
    done
    
    # Check internet connectivity
    if ! curl -s --max-time 5 https://cloudflare.com > /dev/null; then
        log_error "No internet connectivity. Please check your network."
        exit 1
    fi
    
    log_success "Prerequisites met"
    mark_step_completed "$step_name"
}

# Create directory structure
create_directories() {
    local step_name="create_directories"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create directory structure at $HESTIA_TARGET"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Creating directory structure..."
    
    local dirs=(
        "$HESTIA_TARGET"
        "$HESTIA_TARGET/bin"
        "$HESTIA_TARGET/config"
        "$HESTIA_TARGET/data"
        "$HESTIA_TARGET/logs"
        "$HESTIA_TARGET/packages"
        "$HESTIA_TARGET/backups"
        "$HESTIA_TARGET/temp"
    )
    
    for dir in "${dirs[@]}"; do
        mkdir -p "$dir"
        chmod 755 "$dir"
    done
    
    log_success "Directory structure created"
    mark_step_completed "$step_name"
}

# Run a specific phase
run_phase() {
    local phase=$1
    local phase_script="$SCRIPT_DIR/phases/${phase}.sh"
    
    if [[ ! -f "$phase_script" ]]; then
        log_error "Phase script not found: $phase_script"
        return 1
    fi
    
    # Initialize state before running phase
    init_state
    
    log_info "Running ${phase}..."
    
    # Export environment variables for the phase
    export HESTIA_TARGET
    export HESTIA_SAFE_MODE
    export HESTIA_UNATTENDED
    export INSTALL_STATE_FILE
    export INSTALL_STATE_DIR
    export FORCE_MODE
    export RESUME_MODE
    export DRY_RUN_MODE
    export RESET_MODE
    
    # Execute phase script with its own argument parsing
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would execute: $phase_script"
        # Still run the phase script in dry-run mode so it can report what it would do
        if bash "$phase_script" --dry-run; then
            log_success "${phase} dry-run completed"
            set_last_phase "$phase"
            return 0
        else
            log_error "${phase} dry-run failed"
            return 1
        fi
    else
        if bash "$phase_script"; then
            log_success "${phase} completed"
            set_last_phase "$phase"
            return 0
        else
            log_error "${phase} failed"
            return 1
        fi
    fi
}

# Run first-fire wizard
run_wizard() {
    local step_name="first_fire_wizard"
    
    if [[ "$HESTIA_UNATTENDED" == "1" ]]; then
        log_info "Skipping wizard (unattended mode)"
        
        # Check if we should install optional services in unattended mode
        if [[ -n "$WITH_SERVICES" ]]; then
            install_optional_services "$WITH_SERVICES"
        fi
        
        return 0
    fi
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would run first-fire wizard"
        mark_step_completed "$step_name"
        return 0
    fi
    
    local wizard_script="$SCRIPT_DIR/wizard/first-fire.sh"
    
    if [[ -f "$wizard_script" ]]; then
        log_info "Starting first-fire wizard..."
        
        # Pass optional services to wizard
        if [[ -n "$WITH_SERVICES" ]]; then
            export HESTIA_PRESELECTED_SERVICES="$WITH_SERVICES"
        fi
        
        bash "$wizard_script"
        mark_step_completed "$step_name"
    else
        log_warn "Wizard not found, skipping"
    fi
}

# Install optional services in unattended mode
install_optional_services() {
    local services="$1"
    local step_name="optional_services_install"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    log_info "Installing optional services: $services"
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would install optional services: $services"
        mark_step_completed "$step_name"
        return 0
    fi
    
    # Ensure hestia CLI is available
    if ! command -v hestia &> /dev/null; then
        log_warn "hestia CLI not found in PATH. Skipping optional services installation."
        log_info "You can install services later with: hestia services:install <name>"
        return 0
    fi
    
    # Install each service
    IFS=',' read -ra SERVICE_LIST <<< "$services"
    for service in "${SERVICE_LIST[@]}"; do
        service=$(echo "$service" | xargs)  # Trim whitespace
        log_step "Installing $service..."
        
        if hestia services:install "$service" --yes 2>/dev/null; then
            hestia services:enable "$service" 2>/dev/null || true
            log_success "$service installed and enabled"
        else
            log_warn "Failed to install $service"
        fi
    done
    
    mark_step_completed "$step_name"
}

# Main installation flow
main() {
    TARGET_PHASE="all"
    
    # Parse arguments
    parse_args "$@"
    
    show_header
    
    # Handle reset mode first
    if [[ "$RESET_MODE" == true ]]; then
        init_state
        reset_state
        log_info "State has been reset. Run without --reset to proceed with installation."
        exit 0
    fi
    
    # Initialize state
    init_state
    
    # Handle resume mode
    if [[ "$RESUME_MODE" == true ]]; then
        local last_phase=$(get_last_phase)
        if [[ -n "$last_phase" ]]; then
            log_info "Resuming from last completed phase: $last_phase"
            case "$last_phase" in
                phase1)
                    TARGET_PHASE="phase2"  # Continue with phase2
                    ;;
                phase2)
                    TARGET_PHASE="phase3"  # Continue with phase3
                    ;;
                phase3)
                    log_warn "All phases already completed. Use --force to re-run."
                    exit 0
                    ;;
            esac
        else
            log_info "No previous installation state found. Starting fresh."
        fi
    fi
    
    # Run requested phase(s)
    case "$TARGET_PHASE" in
        phase1)
            check_root
            check_prerequisites
            create_directories
            run_phase "phase1"
            ;;
        phase2)
            check_root
            check_prerequisites
            create_directories
            run_phase "phase1"
            run_phase "phase2"
            ;;
        phase3)
            check_root
            check_prerequisites
            create_directories
            run_phase "phase1"
            run_phase "phase2"
            run_phase "phase3"
            ;;
        all)
            check_root
            check_prerequisites
            create_directories
            run_phase "phase1"
            run_phase "phase2"
            run_phase "phase3"
            run_wizard
            ;;
        *)
            log_error "Unknown phase: $TARGET_PHASE"
            show_help
            exit 1
            ;;
    esac
    
    # Success message
    echo -e "${GREEN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║              Installation Complete! 🔥                          ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    # Show final progress
    show_full_progress
    
    log_info "Installation directory: $HESTIA_TARGET"
    log_info "Next steps:"
    log_info "  1. Initialize Hestia: hestia init"
    log_info "  2. Configure packages: hestia add <package>"
    log_info "  3. Start services: hestia ignite"
}

# Run main function
main "$@"
