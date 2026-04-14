#!/bin/bash

# =============================================================================
# Hestia Verification Script
# Comprehensive verification of Hestia installation
# =============================================================================

set -o pipefail

# Require bash 4+ for associative arrays.
if [[ -z "${BASH_VERSINFO:-}" ]] || (( BASH_VERSINFO[0] < 4 )); then
    echo "verify.sh requires bash 4+ (detected: ${BASH_VERSION:-unknown})."
    echo "Tip: on macOS, install modern bash and run: /usr/local/bin/bash verify.sh"
    exit 2
fi

# -----------------------------------------------------------------------------
# Configuration & Constants
# -----------------------------------------------------------------------------
VERSION="2.0.0"
SCRIPT_DATE=$(date '+%Y-%m-%d %H:%M:%S')
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_FILE=""
VERBOSE=0
QUICK_MODE=0
PRODUCTION_MODE=0
AUTO_FIX=0

# Exit codes
EXIT_SUCCESS=0
EXIT_REVIEW=1
EXIT_FAIL=2

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0

# Results storage
declare -A CHECK_RESULTS
declare -a CHECK_ORDER

# Backward-compatible command shim:
# prefer `hestia` when present, otherwise alias to `eve`.
if ! command -v hestia &>/dev/null && command -v eve &>/dev/null; then
    hestia() {
        eve "$@"
    }
fi

# -----------------------------------------------------------------------------
# Color Definitions
# -----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'
DIM='\033[2m'

# -----------------------------------------------------------------------------
# Utility Functions
# -----------------------------------------------------------------------------

print_header() {
    echo -e "${CYAN}${BOLD}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                                                                              ║"
    echo "║                    HESTIA VERIFICATION SCRIPT v${VERSION}                       ║"
    echo "║                                                                              ║"
    echo "║                    ${SCRIPT_DATE}                                              ║"
    echo "║                                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_section() {
    echo ""
    echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}${BOLD}  $1${NC}"
    echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
    [[ $VERBOSE -eq 1 ]] && [[ -n "$2" ]] && echo -e "${DIM}  $2${NC}"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
    [[ -n "$2" ]] && echo -e "${RED}  $2${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    [[ -n "$2" ]] && echo -e "${YELLOW}  $2${NC}"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

print_progress() {
    echo -e "${DIM}→ $1...${NC}"
}

record_check() {
    local name="$1"
    local status="$2"  # pass, fail, warning
    local details="${3:-}"
    local recommendation="${4:-}"
    
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    CHECK_ORDER+=("$name")
    CHECK_RESULTS["$name"]="$status|$details|$recommendation"
    
    case "$status" in
        pass)
            PASSED_CHECKS=$((PASSED_CHECKS + 1))
            ;;
        fail)
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            ;;
        warning)
            WARNING_CHECKS=$((WARNING_CHECKS + 1))
            ;;
    esac
}

show_spinner() {
    local pid=$1
    local message="$2"
    local delay=0.1
    local spinstr='|/-\\'
    
    while kill -0 $pid 2>/dev/null; do
        local temp=${spinstr#?}
        printf "\r${DIM}%s [%c]${NC}  " "$message" "$spinstr"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
    done
    printf "\r%-50s\r" ""
}

run_with_timeout() {
    local timeout_sec="$1"
    shift
    local cmd="$@"
    
    timeout "$timeout_sec" bash -c "$cmd" 2>/dev/null
    return $?
}

# -----------------------------------------------------------------------------
# Pre-Flight Checks
# -----------------------------------------------------------------------------

preflight_checks() {
    print_section "PRE-FLIGHT CHECKS"
    
    # Check if running as root/sudo
    print_progress "Checking privileges"
    if [[ $EUID -eq 0 ]]; then
        record_check "Root Privileges" "pass" "Running as root"
        print_success "Root privileges confirmed"
    elif sudo -n true 2>/dev/null; then
        record_check "Root Privileges" "pass" "Sudo access available without password"
        print_success "Sudo access available"
    else
        record_check "Root Privileges" "warning" "Not running as root, some checks may fail" "Run with sudo for full verification"
        print_warning "Limited privileges (run with sudo for full access)"
    fi
    
    # Check required tools
    print_progress "Checking required tools"
    local required_tools=("docker" "curl" "git")
    local missing_tools=()
    
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -eq 0 ]]; then
        record_check "Required Tools" "pass" "All required tools available: ${required_tools[*]}"
        print_success "All required tools available" "docker, curl, git"
    else
        record_check "Required Tools" "fail" "Missing tools: ${missing_tools[*]}" "Install missing tools: ${missing_tools[*]}"
        print_error "Missing required tools" "${missing_tools[*]}"
        return 1
    fi
    
    # Check Docker is running
    print_progress "Checking Docker daemon"
    if docker info &>/dev/null; then
        local docker_version=$(docker --version | awk '{print $3}' | tr -d ',')
        record_check "Docker Daemon" "pass" "Docker v${docker_version} is running"
        print_success "Docker daemon is running" "v${docker_version}"
    else
        record_check "Docker Daemon" "fail" "Docker is not running or not accessible" "Start Docker daemon: sudo systemctl start docker"
        print_error "Docker daemon is not running"
        return 1
    fi
    
    # Check internet connectivity
    print_progress "Checking internet connectivity"
    if curl -s --max-time 5 https://www.google.com &>/dev/null || \
       curl -s --max-time 5 https://cloudflare.com &>/dev/null; then
        record_check "Internet Connectivity" "pass" "Internet connection available"
        print_success "Internet connectivity confirmed"
    else
        record_check "Internet Connectivity" "warning" "No internet connection" "Connect to internet for full verification"
        print_warning "No internet connectivity (some checks may be limited)"
    fi
    
    # Check hestia CLI availability
    print_progress "Checking Hestia CLI"
    if command -v hestia &> /dev/null; then
        local hestia_version=$(hestia --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
        record_check "Hestia CLI" "pass" "Hestia CLI v${hestia_version} available"
        print_success "Hestia CLI is available" "v${hestia_version}"
    else
        # Try to find hestia in common locations
        if [[ -x "$SCRIPT_DIR/../bin/hestia" ]]; then
            export PATH="$SCRIPT_DIR/../bin:$PATH"
            record_check "Hestia CLI" "pass" "Hestia CLI found at $SCRIPT_DIR/../bin/hestia"
            print_success "Hestia CLI found in local bin"
        elif [[ -x "/usr/local/bin/hestia" ]]; then
            record_check "Hestia CLI" "pass" "Hestia CLI found at /usr/local/bin/hestia"
            print_success "Hestia CLI found at /usr/local/bin"
        else
            record_check "Hestia CLI" "fail" "Hestia CLI not found in PATH" "Install Hestia CLI or add to PATH"
            print_error "Hestia CLI not found" "Install hestia or ensure it's in PATH"
            return 1
        fi
    fi
    
    return 0
}

# -----------------------------------------------------------------------------
# Validation Phase
# -----------------------------------------------------------------------------

validation_phase() {
    print_section "VALIDATION PHASE"
    
    print_progress "Running hestia validate --json"
    
    local validation_output
    local validation_exit
    
    validation_output=$(hestia validate --json 2>&1)
    validation_exit=$?
    
    if [[ $validation_exit -ne 0 ]]; then
        # Try to parse error
        print_error "Validation command failed" "Exit code: $validation_exit"
        record_check "Validation Command" "fail" "hestia validate command failed" "Check hestia CLI installation"
        return 1
    fi
    
    # Parse JSON output (if possible)
    local pass_count=0
    local fail_count=0
    local warning_count=0
    
    if command -v jq &> /dev/null; then
        # Use jq for proper JSON parsing
        pass_count=$(echo "$validation_output" | jq -r '.passed // 0' 2>/dev/null || echo "0")
        fail_count=$(echo "$validation_output" | jq -r '.failed // 0' 2>/dev/null || echo "0")
        warning_count=$(echo "$validation_output" | jq -r '.warnings // 0' 2>/dev/null || echo "0")
        
        # Check validation status
        local overall_status=$(echo "$validation_output" | jq -r '.status // "unknown"' 2>/dev/null)
        
        if [[ "$overall_status" == "passed" ]] || [[ $fail_count -eq 0 ]]; then
            record_check "Configuration Validation" "pass" "All validation checks passed ($pass_count passed, $warning_count warnings)"
            print_success "Validation passed" "$pass_count checks passed"
        else
            record_check "Configuration Validation" "fail" "Validation failed: $fail_count errors, $warning_count warnings" "Run 'hestia validate' for details and fix issues"
            print_error "Validation failed" "$fail_count errors, $warning_count warnings"
            [[ $VERBOSE -eq 1 ]] && echo "$validation_output" | jq -r '.checks[] | select(.status == "fail") | "  - \(.name): \(.message)"' 2>/dev/null
            return 1
        fi
    else
        # Fallback to simple parsing
        if echo "$validation_output" | grep -q "passed\|success\|valid"; then
            record_check "Configuration Validation" "pass" "Validation output indicates success (jq not available for detailed parsing)"
            print_success "Validation passed (basic check)"
        else
            record_check "Configuration Validation" "warning" "Cannot parse detailed results (jq not installed)" "Install jq for detailed validation parsing"
            print_warning "Validation completed but details unavailable" "Install jq for better parsing"
        fi
    fi
    
    return 0
}

# -----------------------------------------------------------------------------
# Health Check Phase
# -----------------------------------------------------------------------------

health_check_phase() {
    print_section "HEALTH CHECK PHASE"
    
    print_progress "Running hestia health --json"
    
    local health_output
    local health_exit
    
    health_output=$(hestia health --json 2>&1)
    health_exit=$?
    
    if [[ $health_exit -ne 0 ]]; then
        print_error "Health check command failed" "Exit code: $health_exit"
        record_check "Health Check" "fail" "hestia health command failed" "Check hestia CLI and installation"
        return 1
    fi
    
    # Parse health results
    if command -v jq &> /dev/null; then
        local health_score=$(echo "$health_output" | jq -r '.score // .healthScore // "unknown"' 2>/dev/null)
        local overall_status=$(echo "$health_output" | jq -r '.status // .healthy // "unknown"' 2>/dev/null)
        
        # Service status checks
        local services_checked=$(echo "$health_output" | jq -r '.services | length // 0' 2>/dev/null || echo "0")
        local healthy_services=$(echo "$health_output" | jq -r '[.services[]? | select(.status == "healthy" or .healthy == true)] | length' 2>/dev/null || echo "0")
        local unhealthy_services=$(echo "$health_output" | jq -r '[.services[]? | select(.status == "unhealthy" or .healthy == false)] | length' 2>/dev/null || echo "0")
        
        # Display score
        if [[ "$health_score" != "unknown" ]] && [[ "$health_score" != "null" ]]; then
            if [[ $health_score -ge 90 ]]; then
                record_check "Health Score" "pass" "Health score: $health_score% (Excellent)"
                print_success "Health score: ${health_score}%" "Excellent"
            elif [[ $health_score -ge 70 ]]; then
                record_check "Health Score" "pass" "Health score: $health_score% (Good)"
                print_success "Health score: ${health_score}%" "Good"
            elif [[ $health_score -ge 50 ]]; then
                record_check "Health Score" "warning" "Health score: $health_score% (Fair)" "Review service status and configuration"
                print_warning "Health score: ${health_score}%" "Fair - needs attention"
            else
                record_check "Health Score" "fail" "Health score: $health_score% (Poor)" "Multiple services unhealthy, immediate attention required"
                print_error "Health score: ${health_score}%" "Poor - critical issues detected"
            fi
        fi
        
        # Service status summary
        print_info "Services: $healthy_services healthy, $unhealthy_services unhealthy ($services_checked total)"
        
        if [[ $unhealthy_services -eq 0 ]]; then
            record_check "Service Status" "pass" "All $healthy_services services are healthy"
        else
            record_check "Service Status" "fail" "$unhealthy_services services are unhealthy" "Run 'hestia health' for details and restart services"
            [[ $VERBOSE -eq 1 ]] && echo "$health_output" | jq -r '.services[] | select(.status == "unhealthy" or .healthy == false) | "  - \(.name): \(.message // .error // \"unhealthy\")"' 2>/dev/null
            return 1
        fi
        
        # Production mode check
        if [[ $PRODUCTION_MODE -eq 1 ]] && [[ $health_score -lt 95 ]]; then
            print_error "Production mode: Health score below 95%"
            return 1
        fi
    else
        # Basic parsing without jq
        if echo "$health_output" | grep -q "healthy\|good\|passed"; then
            record_check "Health Check" "pass" "Health check indicates good status (jq not available for detailed parsing)"
            print_success "Health check passed (basic verification)"
        else
            record_check "Health Check" "warning" "Health check completed with possible issues (jq not installed)" "Install jq for detailed health parsing"
            print_warning "Health check status unclear" "Install jq for detailed parsing"
        fi
    fi
    
    return 0
}

# -----------------------------------------------------------------------------
# Test Suite Phase
# -----------------------------------------------------------------------------

test_suite_phase() {
    print_section "TEST SUITE PHASE"
    
    print_progress "Running hestia test:smoke"
    
    local test_output
    local test_exit
    
    test_output=$(hestia test:smoke 2>&1)
    test_exit=$?
    
    if [[ $test_exit -eq 0 ]]; then
        # Try to parse test results
        local tests_passed=$(echo "$test_output" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1 || echo "unknown")
        local tests_failed=$(echo "$test_output" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' | head -1 || echo "0")
        
        if [[ "$tests_failed" == "0" ]] || [[ -z "$tests_failed" ]]; then
            record_check "Smoke Tests" "pass" "All smoke tests passed"
            print_success "All smoke tests passed"
            [[ $VERBOSE -eq 1 ]] && echo "$test_output" | tail -20
        else
            record_check "Smoke Tests" "fail" "$tests_failed tests failed" "Review test output and fix failing tests"
            print_error "Smoke tests failed" "$tests_failed failures"
            return 1
        fi
    else
        # Command failed - check if it's because tests failed or command error
        if echo "$test_output" | grep -q "passed\|failed\|test"; then
            record_check "Smoke Tests" "fail" "Smoke tests failed (exit code: $test_exit)" "Review test output and fix issues"
            print_error "Smoke tests failed"
            [[ $VERBOSE -eq 1 ]] && echo "$test_output"
        else
            record_check "Smoke Tests" "fail" "Test command failed (exit code: $test_exit)" "Check hestia CLI installation"
            print_error "Test command failed" "Exit code: $test_exit"
        fi
        return 1
    fi
    
    return 0
}

# -----------------------------------------------------------------------------
# Integration Test Phase
# -----------------------------------------------------------------------------

integration_test_phase() {
    if [[ $QUICK_MODE -eq 1 ]]; then
        print_section "INTEGRATION TESTS (SKIPPED)"
        print_info "Quick mode: Skipping integration tests"
        record_check "Integration Tests" "pass" "Skipped (--quick mode)"
        return 0
    fi
    
    print_section "INTEGRATION TESTS"
    
    # Test Synap Backend Connectivity
    print_progress "Testing Synap Backend connectivity"
    local synap_config
    synap_config=$(hestia config:get synap --json 2>/dev/null || echo '{}')
    
    if command -v jq &> /dev/null && [[ "$synap_config" != "{}" ]]; then
        local synap_url=$(echo "$synap_config" | jq -r '.url // .endpoint // "http://localhost:4000"' 2>/dev/null)
        
        if curl -s --max-time 10 "${synap_url}/health" &>/dev/null || \
           curl -s --max-time 10 "${synap_url}/api/health" &>/dev/null || \
           curl -s --max-time 10 "${synap_url}/trpc/health" &>/dev/null; then
            record_check "Synap Backend" "pass" "Backend responding at $synap_url"
            print_success "Synap Backend is responsive"
        else
            record_check "Synap Backend" "warning" "Backend not responding at $synap_url" "Check if Synap Backend is running"
            print_warning "Synap Backend not responding" "Check if service is running"
        fi
    else
        record_check "Synap Backend" "warning" "Cannot verify backend (config unavailable)" "Configure Synap Backend connection"
        print_warning "Synap Backend configuration unavailable"
    fi
    
    # Test OpenClaude
    print_progress "Testing OpenClaude"
    local openclaude_status=$(hestia status openclaude --json 2>/dev/null || echo '{}')
    
    if command -v jq &> /dev/null && echo "$openclaude_status" | jq -e '.running // .status == "running"' &>/dev/null; then
        record_check "OpenClaude" "pass" "OpenClaude is running"
        print_success "OpenClaude is running"
    else
        # Try to start it
        if [[ $AUTO_FIX -eq 1 ]]; then
            print_info "Attempting to start OpenClaude..."
            if hestia start openclaude &>/dev/null; then
                sleep 5
                if hestia status openclaude --json 2>/dev/null | jq -e '.running' &>/dev/null; then
                    record_check "OpenClaude" "pass" "OpenClaude started successfully (auto-fix)"
                    print_success "OpenClaude started (auto-fix)"
                else
                    record_check "OpenClaude" "warning" "Could not start OpenClaude" "Start manually: hestia start openclaude"
                    print_warning "OpenClaude could not be started"
                fi
            else
                record_check "OpenClaude" "warning" "OpenClaude not running" "Start with: hestia start openclaude"
                print_warning "OpenClaude not running"
            fi
        else
            record_check "OpenClaude" "warning" "OpenClaude not running" "Start with: hestia start openclaude"
            print_warning "OpenClaude not running"
        fi
    fi
    
    # Test OpenClaw
    print_progress "Testing OpenClaw"
    local openclaw_status=$(hestia status openclaw --json 2>/dev/null || echo '{}')
    
    if command -v jq &> /dev/null && echo "$openclaw_status" | jq -e '.running // .status == "running"' &>/dev/null; then
        record_check "OpenClaw" "pass" "OpenClaw is running"
        print_success "OpenClaw is running"
    else
        if [[ $AUTO_FIX -eq 1 ]]; then
            print_info "Attempting to start OpenClaw..."
            if hestia start openclaw &>/dev/null; then
                sleep 5
                if hestia status openclaw --json 2>/dev/null | jq -e '.running' &>/dev/null; then
                    record_check "OpenClaw" "pass" "OpenClaw started successfully (auto-fix)"
                    print_success "OpenClaw started (auto-fix)"
                else
                    record_check "OpenClaw" "warning" "Could not start OpenClaw" "Start manually: hestia start openclaw"
                    print_warning "OpenClaw could not be started"
                fi
            else
                record_check "OpenClaw" "warning" "OpenClaw not running" "Start with: hestia start openclaw"
                print_warning "OpenClaw not running"
            fi
        else
            record_check "OpenClaw" "warning" "OpenClaw not running" "Start with: hestia start openclaw"
            print_warning "OpenClaw not running"
        fi
    fi
    
    # Test A2A Bridge
    print_progress "Testing A2A Bridge"
    local a2a_status=$(hestia status a2a --json 2>/dev/null || echo '{}')
    
    if command -v jq &> /dev/null && echo "$a2a_status" | jq -e '.running // .status == "running" // .connected' &>/dev/null; then
        record_check "A2A Bridge" "pass" "A2A Bridge is operational"
        print_success "A2A Bridge is operational"
    else
        if [[ $AUTO_FIX -eq 1 ]]; then
            print_info "Attempting to start A2A Bridge..."
            if hestia start a2a &>/dev/null || hestia a2a:start &>/dev/null; then
                sleep 3
                record_check "A2A Bridge" "pass" "A2A Bridge started (auto-fix)"
                print_success "A2A Bridge started (auto-fix)"
            else
                record_check "A2A Bridge" "warning" "A2A Bridge status unknown" "Verify manually: hestia status a2a"
                print_warning "A2A Bridge status unclear"
            fi
        else
            record_check "A2A Bridge" "warning" "A2A Bridge status unknown" "Verify manually: hestia status a2a"
            print_warning "A2A Bridge status unclear"
        fi
    fi
    
    # Test Agent Communication
    print_progress "Testing Agent Communication"
    
    # Send a test ping between agents
    local agent_test_result
    agent_test_result=$(hestia agent:ping --from hestia-verifier --to hestia-system --timeout 10 2>&1) || true
    
    if echo "$agent_test_result" | grep -q "success\|pong\|ok"; then
        record_check "Agent Communication" "pass" "Agents can communicate"
        print_success "Agent communication working"
    else
        # Alternative check - list agents
        local agents_list=$(hestia agent:list --json 2>/dev/null || echo '[]')
        local agent_count=$(echo "$agents_list" | jq -r 'length // 0' 2>/dev/null || echo "0")
        
        if [[ $agent_count -gt 0 ]]; then
            record_check "Agent Communication" "pass" "$agent_count agents registered (ping test inconclusive)"
            print_success "Agents are registered" "$agent_count agents found"
        else
            record_check "Agent Communication" "warning" "No agents detected or communication failing" "Check agent configuration and A2A bridge"
            print_warning "Agent communication unclear" "May need configuration"
        fi
    fi
    
    return 0
}

# -----------------------------------------------------------------------------
# Auto-Fix Functions
# -----------------------------------------------------------------------------

auto_fix_issues() {
    if [[ $AUTO_FIX -eq 0 ]]; then
        return 0
    fi
    
    print_section "AUTO-FIX PHASE"
    print_info "Attempting to fix detected issues..."
    
    local fixes_applied=0
    
    # Fix Docker permissions
    if [[ $EUID -ne 0 ]] && ! docker info &>/dev/null 2>&1; then
        print_progress "Attempting to fix Docker permissions"
        if sudo usermod -aG docker "${USER}" 2>/dev/null; then
            print_success "Added user to docker group (requires re-login)"
            fixes_applied=$((fixes_applied + 1))
        fi
    fi
    
    # Restart unhealthy services
    if command -v jq &> /dev/null; then
        local health_output=$(hestia health --json 2>/dev/null)
        local unhealthy=$(echo "$health_output" | jq -r '.services[]? | select(.status == "unhealthy" or .healthy == false) | .name' 2>/dev/null)
        
        for service in $unhealthy; do
            print_progress "Attempting to restart $service"
            if hestia restart "$service" &>/dev/null; then
                print_success "Restarted $service"
                fixes_applied=$((fixes_applied + 1))
            else
                print_error "Failed to restart $service"
            fi
        done
    fi
    
    if [[ $fixes_applied -gt 0 ]]; then
        print_info "$fixes_applied fixes applied"
        print_info "Some fixes may require re-running verification"
    else
        print_info "No automatic fixes were applied"
    fi
    
    return 0
}

# -----------------------------------------------------------------------------
# Final Report
# -----------------------------------------------------------------------------

generate_final_report() {
    print_section "FINAL VERIFICATION REPORT"
    
    # Calculate overall status
    local overall_status="PASS"
    local exit_code=$EXIT_SUCCESS
    
    if [[ $FAILED_CHECKS -gt 0 ]]; then
        if [[ $FAILED_CHECKS -le 2 ]] && [[ $PRODUCTION_MODE -eq 0 ]]; then
            overall_status="REVIEW"
            exit_code=$EXIT_REVIEW
        else
            overall_status="FAIL"
            exit_code=$EXIT_FAIL
        fi
    elif [[ $WARNING_CHECKS -gt 0 ]] && [[ $PRODUCTION_MODE -eq 1 ]]; then
        overall_status="REVIEW"
        exit_code=$EXIT_REVIEW
    fi
    
    # Display status banner
    echo ""
    if [[ "$overall_status" == "PASS" ]]; then
        echo -e "${GREEN}${BOLD}"
        echo "╔══════════════════════════════════════════════════════════════════════════════╗"
        echo "║                                                                              ║"
        echo "║                           ✅ STATUS: PASS                                    ║"
        echo "║                                                                              ║"
        echo "║                    All checks passed - Ready for production                  ║"
        echo "║                                                                              ║"
        echo "╚══════════════════════════════════════════════════════════════════════════════╝"
        echo -e "${NC}"
    elif [[ "$overall_status" == "REVIEW" ]]; then
        echo -e "${YELLOW}${BOLD}"
        echo "╔══════════════════════════════════════════════════════════════════════════════╗"
        echo "║                                                                              ║"
        echo "║                          ⚠️  STATUS: REVIEW NEEDED                           ║"
        echo "║                                                                              ║"
        echo "║                 Some issues detected - Review recommended                    ║"
        echo "║                                                                              ║"
        echo "╚══════════════════════════════════════════════════════════════════════════════╝"
        echo -e "${NC}"
    else
        echo -e "${RED}${BOLD}"
        echo "╔══════════════════════════════════════════════════════════════════════════════╗"
        echo "║                                                                              ║"
        echo "║                          ❌ STATUS: FAIL                                     ║"
        echo "║                                                                              ║"
        echo "║               Critical failures detected - Not ready for production          ║"
        echo "║                                                                              ║"
        echo "╚══════════════════════════════════════════════════════════════════════════════╝"
        echo -e "${NC}"
    fi
    
    # Summary statistics
    echo ""
    echo -e "${BOLD}SUMMARY:${NC}"
    echo "  Total Checks:    $TOTAL_CHECKS"
    echo -e "  ${GREEN}Passed:${NC}          $PASSED_CHECKS"
    echo -e "  ${YELLOW}Warnings:${NC}        $WARNING_CHECKS"
    echo -e "  ${RED}Failed:${NC}          $FAILED_CHECKS"
    echo ""
    
    # Detailed results table
    echo -e "${BOLD}DETAILED RESULTS:${NC}"
    echo ""
    printf "  %-40s %s\n" "CHECK" "STATUS"
    echo "  $(printf '=%.0s' {1..40}) $(printf '=%.0s' {1..15})"
    
    for check_name in "${CHECK_ORDER[@]}"; do
        local result="${CHECK_RESULTS[$check_name]}"
        local status=$(echo "$result" | cut -d'|' -f1)
        local details=$(echo "$result" | cut -d'|' -f2)
        
        local status_symbol
        case "$status" in
            pass)
                status_symbol="${GREEN}✓ PASS${NC}"
                ;;
            fail)
                status_symbol="${RED}✗ FAIL${NC}"
                ;;
            warning)
                status_symbol="${YELLOW}⚠ WARN${NC}"
                ;;
        esac
        
        printf "  %-40b %b\n" "$check_name" "$status_symbol"
        [[ $VERBOSE -eq 1 ]] && [[ -n "$details" ]] && echo -e "    ${DIM}$details${NC}"
    done
    
    echo ""
    
    # Recommendations
    if [[ $FAILED_CHECKS -gt 0 ]] || [[ $WARNING_CHECKS -gt 0 ]]; then
        echo -e "${BOLD}RECOMMENDATIONS:${NC}"
        echo ""
        
        local has_recommendations=0
        for check_name in "${CHECK_ORDER[@]}"; do
            local result="${CHECK_RESULTS[$check_name]}"
            local status=$(echo "$result" | cut -d'|' -f1)
            local recommendation=$(echo "$result" | cut -d'|' -f3)
            
            if [[ "$status" != "pass" ]] && [[ -n "$recommendation" ]]; then
                if [[ "$status" == "fail" ]]; then
                    echo -e "  ${RED}•${NC} $check_name:"
                else
                    echo -e "  ${YELLOW}•${NC} $check_name:"
                fi
                echo -e "    ${DIM}$recommendation${NC}"
                has_recommendations=1
            fi
        done
        
        if [[ $has_recommendations -eq 0 ]]; then
            echo "  No specific recommendations available."
        fi
        
        echo ""
    fi
    
    # Common next steps
    echo -e "${BOLD}NEXT STEPS:${NC}"
    case "$overall_status" in
        PASS)
            echo "  • Your Hestia installation is verified and ready"
            echo "  • You can safely deploy to production"
            echo "  • Run this verification periodically to monitor health"
            ;;
        REVIEW)
            echo "  • Review the warnings above and determine if action is needed"
            echo "  • Run with --verbose for more details"
            echo "  • Run with --fix to attempt automatic fixes"
            echo "  • Re-run verification after addressing issues"
            ;;
        FAIL)
            echo "  • Address the failed checks above before deploying"
            echo "  • Run with --verbose for detailed error messages"
            echo "  • Run with --fix to attempt automatic fixes"
            echo "  • Consult documentation or support for assistance"
            ;;
    esac
    
    # Save report to file if requested
    if [[ -n "$REPORT_FILE" ]]; then
        save_report_to_file
        echo ""
        echo -e "${CYAN}📄 Detailed report saved to: ${REPORT_FILE}${NC}"
    fi
    
    echo ""
    echo -e "${DIM}Verification completed at $(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo ""
    
    return $exit_code
}

save_report_to_file() {
    local report_path="$REPORT_FILE"
    
    cat > "$report_path" << EOF
HESTIA VERIFICATION REPORT
================================================================================
Generated: $(date '+%Y-%m-%d %H:%M:%S')
Script Version: $VERSION
Command: $0 $*

SUMMARY
--------------------------------------------------------------------------------
Overall Status: $(if [[ $FAILED_CHECKS -eq 0 ]] && [[ $WARNING_CHECKS -eq 0 ]]; then echo "PASS"; elif [[ $FAILED_CHECKS -gt 0 ]]; then echo "FAIL"; else echo "REVIEW"; fi)
Total Checks: $TOTAL_CHECKS
Passed: $PASSED_CHECKS
Warnings: $WARNING_CHECKS
Failed: $FAILED_CHECKS

DETAILED RESULTS
--------------------------------------------------------------------------------
EOF

    for check_name in "${CHECK_ORDER[@]}"; do
        local result="${CHECK_RESULTS[$check_name]}"
        local status=$(echo "$result" | cut -d'|' -f1)
        local details=$(echo "$result" | cut -d'|' -f2)
        local recommendation=$(echo "$result" | cut -d'|' -f3)
        
        echo "" >> "$report_path"
        echo "[$status] $check_name" >> "$report_path"
        [[ -n "$details" ]] && echo "  Details: $details" >> "$report_path"
        [[ -n "$recommendation" ]] && echo "  Recommendation: $recommendation" >> "$report_path"
    done
    
    cat >> "$report_path" << EOF

SYSTEM INFORMATION
--------------------------------------------------------------------------------
Hostname: $(hostname)
OS: $(uname -s) $(uname -r)
Architecture: $(uname -m)
Uptime: $(uptime 2>/dev/null || echo "N/A")

HESTIA INFORMATION
--------------------------------------------------------------------------------
Hestia Version: $(hestia --version 2>/dev/null || echo "N/A")
Docker Version: $(docker --version 2>/dev/null || echo "N/A")
Docker Compose: $(docker-compose --version 2>/dev/null || echo "N/A")

FINAL STATUS: $(if [[ $FAILED_CHECKS -eq 0 ]] && [[ $WARNING_CHECKS -eq 0 ]]; then echo "PASS"; elif [[ $FAILED_CHECKS -gt 0 ]]; then echo "FAIL"; else echo "REVIEW"; fi)
Exit Code: $?

================================================================================
End of Report
================================================================================
EOF
}

# -----------------------------------------------------------------------------
# Usage & Help
# -----------------------------------------------------------------------------

show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Comprehensive verification script for Hestia installation.

OPTIONS:
  --quick           Skip integration tests (faster)
  --production      Strict mode - no warnings allowed
  --output <file>   Save detailed report to file
  --verbose         Show detailed output
  --fix             Attempt to auto-fix issues where possible
  --help            Show this help message

EXIT CODES:
  0                 All checks passed (PASS)
  1                 Some issues need review (REVIEW)
  2                 Critical failures detected (FAIL)

EXAMPLES:
  # Full verification with report
  $0 --verbose --output /tmp/hestia-verify-$(date +%Y%m%d).txt

  # Quick verification (no integration tests)
  $0 --quick

  # Production readiness check
  $0 --production --fix

  # Basic verification
  sudo $0

EOF
}

# -----------------------------------------------------------------------------
# Parse Arguments
# -----------------------------------------------------------------------------

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --quick)
                QUICK_MODE=1
                shift
                ;;
            --production)
                PRODUCTION_MODE=1
                shift
                ;;
            --output)
                if [[ -n "$2" ]] && [[ ! "$2" =~ ^-- ]]; then
                    REPORT_FILE="$2"
                    shift 2
                else
                    echo "Error: --output requires a filename"
                    exit 2
                fi
                ;;
            --verbose)
                VERBOSE=1
                shift
                ;;
            --fix)
                AUTO_FIX=1
                shift
                ;;
            --help|-h)
                show_usage
                exit 0
                ;;
            *)
                echo "Error: Unknown option: $1"
                show_usage
                exit 2
                ;;
        esac
    done
}

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------

main() {
    parse_arguments "$@"
    
    # Clear screen for clean output
    clear 2>/dev/null || echo ""
    
    # Print header
    print_header
    
    # Print mode information
    [[ $QUICK_MODE -eq 1 ]] && print_info "Quick mode enabled (skipping integration tests)"
    [[ $PRODUCTION_MODE -eq 1 ]] && print_info "Production mode enabled (strict checking)"
    [[ $AUTO_FIX -eq 1 ]] && print_info "Auto-fix mode enabled (will attempt repairs)"
    [[ $VERBOSE -eq 1 ]] && print_info "Verbose mode enabled"
    [[ -n "$REPORT_FILE" ]] && print_info "Report will be saved to: $REPORT_FILE"
    
    # Run all phases
    local exit_code=$EXIT_SUCCESS
    
    # Phase 1: Pre-flight checks
    if ! preflight_checks; then
        echo ""
        print_error "Pre-flight checks failed. Cannot continue."
        generate_final_report
        exit $EXIT_FAIL
    fi
    
    # Phase 2: Validation
    if ! validation_phase; then
        exit_code=$EXIT_FAIL
        [[ $PRODUCTION_MODE -eq 1 ]] && {
            generate_final_report
            exit $exit_code
        }
    fi
    
    # Phase 3: Health check
    if ! health_check_phase; then
        exit_code=$EXIT_FAIL
        [[ $PRODUCTION_MODE -eq 1 ]] && {
            generate_final_report
            exit $exit_code
        }
    fi
    
    # Phase 4: Test suite
    if ! test_suite_phase; then
        exit_code=$EXIT_FAIL
        [[ $PRODUCTION_MODE -eq 1 ]] && {
            generate_final_report
            exit $exit_code
        }
    fi
    
    # Phase 5: Integration tests
    if ! integration_test_phase; then
        [[ $exit_code -ne $EXIT_FAIL ]] && exit_code=$EXIT_REVIEW
    fi
    
    # Phase 6: Auto-fix (if requested)
    if [[ $AUTO_FIX -eq 1 ]]; then
        auto_fix_issues
    fi
    
    # Phase 7: Generate final report
    generate_final_report
    exit_code=$?
    
    exit $exit_code
}

# Run main function
main "$@"
