#!/bin/bash
# Tunnel Setup Wizard for Hestia
# Interactive wizard for configuring Pangolin secure tunnel access
#
# Usage: source tunnel-setup.sh or run directly: ./tunnel-setup.sh
#
# This wizard guides users through:
# - Selecting server or client mode
# - Configuring WireGuard keys
# - Setting up domain and ports
# - Connecting client to server

set -euo pipefail

# Configuration
HESTIA_TARGET="${HESTIA_TARGET:-/opt/hestia}"
HESTIA_CONFIG_DIR="${HESTIA_CONFIG_DIR:-$HESTIA_TARGET/config}"
DATA_DIR="${DATA_DIR:-$HESTIA_TARGET/data}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Logging
log_info() { echo -e "${BLUE}[TUNNEL]${NC} $1"; }
log_success() { echo -e "${GREEN}[TUNNEL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[TUNNEL]${NC} $1"; }
log_error() { echo -e "${RED}[TUNNEL]${NC} $1"; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

# Check if running interactively
check_interactive() {
    if [[ ! -t 0 ]]; then
        log_error "This wizard requires an interactive terminal"
        log_info "Use hestia tunnel:enable for non-interactive setup"
        exit 1
    fi
}

# Show welcome message
show_welcome() {
    clear
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║           🔥 Hestia Tunnel Setup Wizard 🔥                    ║"
    echo "║                                                               ║"
    echo "║   Secure remote access using Pangolin + WireGuard            ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "This wizard will help you set up secure remote access to your Hestia node."
    echo ""
    echo "${CYAN}Why Pangolin?${NC}"
    echo "  • Self-hosted (no Cloudflare dependency)"
    echo "  • WireGuard-based (fast, secure encryption)"
    echo "  • Works behind CGNAT (no port forwarding needed)"
    echo "  • Identity-aware access control"
    echo "  • Optional component (not required)"
    echo ""
    echo "${YELLOW}Requirements:${NC}"
    echo "  • Server mode: A VPS with public IP (acts as relay)"
    echo "  • Client mode: Home server with internet access"
    echo ""
    read -p "Press Enter to continue..."
}

# Detect if running on server or client
auto_detect_mode() {
    # Check if we have a public IP
    local public_ip
    public_ip=$(curl -s https://api.ipify.org 2>/dev/null || echo "")
    
    if [[ -n "$public_ip" ]]; then
        # Check if IP is in CGNAT range (100.64.0.0/10)
        local first_octet second_octet
        first_octet=$(echo "$public_ip" | cut -d. -f1)
        second_octet=$(echo "$public_ip" | cut -d. -f2)
        
        if [[ "$first_octet" == "100" ]] && [[ "$second_octet" -ge 64 && "$second_octet" -le 127 ]]; then
            log_info "Detected CGNAT IP address ($public_ip)"
            echo "client"
            return 0
        else
            # Has public IP, could be server
            log_info "Detected public IP address ($public_ip)"
            echo "server"
            return 0
        fi
    fi
    
    echo "unknown"
}

# Select mode interactively
select_mode() {
    local detected_mode
    detected_mode=$(auto_detect_mode)
    
    echo ""
    echo "═══════════════════════════════════════════════════"
    log_step "Select Tunnel Mode"
    echo ""
    
    if [[ "$detected_mode" == "server" ]]; then
        echo "${GREEN}Detected: You appear to have a public IP address.${NC}"
        echo "You can run Pangolin as a SERVER (relay) for other nodes."
        echo ""
    elif [[ "$detected_mode" == "client" ]]; then
        echo "${YELLOW}Detected: You appear to be behind CGNAT.${NC}"
        echo "You should run Pangolin as a CLIENT to connect to a server."
        echo ""
    fi
    
    echo "Options:"
    echo "  1) SERVER - Run on VPS with public IP (acts as relay)"
    echo "  2) CLIENT - Connect home server to a Pangolin server"
    echo "  3) Skip - Don't set up tunnel now"
    echo ""
    
    local default_choice
    if [[ "$detected_mode" == "server" ]]; then
        default_choice="1"
    elif [[ "$detected_mode" == "client" ]]; then
        default_choice="2"
    else
        default_choice="3"
    fi
    
    read -p "Select mode [1/2/3] ($default_choice): " mode_choice
    mode_choice=${mode_choice:-$default_choice}
    
    case "$mode_choice" in
        1)
            TUNNEL_MODE="server"
            ;;
        2)
            TUNNEL_MODE="client"
            ;;
        *)
            log_info "Skipping tunnel setup"
            exit 0
            ;;
    esac
    
    log_success "Selected mode: ${TUNNEL_MODE^^}"
}

# Configure server mode
configure_server() {
    echo ""
    echo "═══════════════════════════════════════════════════"
    log_step "Server Configuration"
    echo ""
    echo "This will set up Pangolin as a relay server on your VPS."
    echo "Home servers can connect to this server for remote access."
    echo ""
    
    # Get domain
    local current_domain
    current_domain=$(grep "^HESTIA_DOMAIN=" "$HESTIA_CONFIG_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "")
    current_domain=${current_domain:-"example.com"}
    
    read -p "Tunnel domain (e.g., tunnel.${current_domain}): " tunnel_domain
    tunnel_domain=${tunnel_domain:-"tunnel.${current_domain}"}
    
    # Get ports
    read -p "Server web port [3000]: " server_port
    server_port=${server_port:-3000}
    
    read -p "WireGuard UDP port [51820]: " wg_port
    wg_port=${wg_port:-51820}
    
    # Generate API key
    local api_key
    api_key=$(openssl rand -hex 32)
    
    # Generate WireGuard keys
    local wg_private_key wg_public_key
    if command -v wg &> /dev/null; then
        wg_private_key=$(wg genkey)
        wg_public_key=$(echo "$wg_private_key" | wg pubkey)
    else
        wg_private_key=$(openssl rand -base64 44 | tr -d '\n')
        wg_public_key=$(openssl rand -base64 44 | tr -d '\n')
    fi
    
    log_step "Saving configuration..."
    
    # Update .env file
    cat >> "$HESTIA_CONFIG_DIR/.env" << EOF

# Pangolin Server Configuration
TUNNEL_MODE=server
PANGOLIN_DOMAIN=$tunnel_domain
PANGOLIN_BASE_URL=https://$tunnel_domain
PANGOLIN_SERVER_PORT=$server_port
PANGOLIN_WG_PORT=$wg_port
PANGOLIN_API_KEY=$api_key
PANGOLIN_WG_PRIVATE_KEY=$wg_private_key
PANGOLIN_WG_PUBLIC_KEY=$wg_public_key
EOF
    
    # Create client token
    local client_token
    client_token=$(openssl rand -hex 16)
    
    echo ""
    log_success "Server configuration complete!"
    echo ""
    echo "${CYAN}Server Details:${NC}"
    echo "  Domain: $tunnel_domain"
    echo "  Web Port: $server_port"
    echo "  WireGuard Port: $wg_port"
    echo "  Public Key: ${wg_public_key:0:32}..."
    echo ""
    echo "${YELLOW}Client Registration Token:${NC}"
    echo "  $client_token"
    echo ""
    echo "${GREEN}Share this token with home servers to connect.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Start the server: ${CYAN}hestia tunnel:enable${NC}"
    echo "  2. On home servers, run: ${CYAN}hestia tunnel:enable --mode client${NC}"
    echo "  3. Use this server URL: ${CYAN}https://$tunnel_domain${NC}"
    echo "  4. Use the token above for client registration"
}

# Configure client mode
configure_client() {
    echo ""
    echo "═══════════════════════════════════════════════════"
    log_step "Client Configuration"
    echo ""
    echo "This will connect your home server to a Pangolin server."
    echo "You need a Pangolin server running on a VPS with public IP."
    echo ""
    
    # Get server URL
    read -p "Pangolin Server URL (e.g., https://tunnel.example.com): " server_url
    
    if [[ -z "$server_url" ]]; then
        log_error "Server URL is required"
        exit 1
    fi
    
    # Get registration token
    read -p "Registration token from server: " client_token
    
    if [[ -z "$client_token" ]]; then
        log_error "Registration token is required"
        exit 1
    fi
    
    # Generate WireGuard keys for client
    local wg_private_key wg_public_key
    if command -v wg &> /dev/null; then
        wg_private_key=$(wg genkey)
        wg_public_key=$(echo "$wg_private_key" | wg pubkey)
    else
        wg_private_key=$(openssl rand -base64 44 | tr -d '\n')
        wg_public_key=$(openssl rand -base64 44 | tr -d '\n')
    fi
    
    log_step "Saving configuration..."
    
    # Get hearth name for client identification
    local client_name
    client_name=$(grep "^HEARTH_NAME=" "$HESTIA_CONFIG_DIR/.env" 2>/dev/null | cut -d= -f2 || hostname)
    
    # Update .env file
    cat >> "$HESTIA_CONFIG_DIR/.env" << EOF

# Pangolin Client Configuration
TUNNEL_MODE=client
PANGOLIN_SERVER_URL=$server_url
PANGOLIN_CLIENT_TOKEN=$client_token
PANGOLIN_CLIENT_NAME=$client_name
PANGOLIN_WG_PRIVATE_KEY=$wg_private_key
PANGOLIN_WG_PUBLIC_KEY=$wg_public_key

# Tunnels to expose (name:localPort)
PANGOLIN_TUNNELS=synap:4000,openclaw:8080
EOF
    
    echo ""
    log_success "Client configuration complete!"
    echo ""
    echo "${CYAN}Client Details:${NC}"
    echo "  Server: $server_url"
    echo "  Client Name: $client_name"
    echo "  Public Key: ${wg_public_key:0:32}..."
    echo ""
    echo "Tunnels configured:"
    echo "  • synap (port 4000)"
    echo "  • openclaw (port 8080)"
    echo ""
    echo "Next steps:"
    echo "  1. Start the tunnel: ${CYAN}hestia tunnel:enable${NC}"
    echo "  2. Check status: ${CYAN}hestia tunnel:status${NC}"
    echo "  3. Your home server will be accessible at:"
    echo "     ${CYAN}$server_url/synap${NC}"
    echo "     ${CYAN}$server_url/openclaw${NC}"
}

# Start Pangolin services
start_pangolin() {
    echo ""
    log_step "Starting Pangolin..."
    
    if [[ ! -f "$HESTIA_TARGET/docker-compose.pangolin.yml" ]]; then
        log_warn "Pangolin Docker Compose not found"
        log_info "Creating from template..."
        
        # Create minimal compose file
        mkdir -p "$HESTIA_TARGET"
        cat > "$HESTIA_TARGET/docker-compose.pangolin.yml" << 'EOF'
version: '3.8'
services:
  pangolin-server:
    image: fosrl/pangolin:latest
    profiles: [pangolin-server]
    environment:
      PANGOLIN_MODE: server
    ports:
      - "3000:3000"
      - "51820:51820/udp"
    networks:
      - hestia-network
  pangolin-client:
    image: fosrl/pangolin:latest
    profiles: [pangolin-client]
    environment:
      PANGOLIN_MODE: client
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    networks:
      - hestia-network
networks:
  hestia-network:
    external: true
EOF
    fi
    
    # Start with appropriate profile
    local profile
    if [[ "$TUNNEL_MODE" == "server" ]]; then
        profile="pangolin-server"
    else
        profile="pangolin-client"
    fi
    
    cd "$HESTIA_TARGET"
    docker compose -f docker-compose.pangolin.yml --profile "$profile" up -d || {
        log_error "Failed to start Pangolin"
        exit 1
    }
    
    log_success "Pangolin started successfully!"
}

# Show completion message
show_completion() {
    echo ""
    echo "═══════════════════════════════════════════════════"
    echo ""
    log_success "Tunnel Setup Complete! 🔥"
    echo ""
    
    if [[ "$TUNNEL_MODE" == "server" ]]; then
        local server_port
        server_port=$(grep "^PANGOLIN_SERVER_PORT=" "$HESTIA_CONFIG_DIR/.env" | cut -d= -f2)
        local domain
        domain=$(grep "^PANGOLIN_DOMAIN=" "$HESTIA_CONFIG_DIR/.env" | cut -d= -f2)
        
        echo "Your Pangolin server is running at:"
        echo "  ${CYAN}https://$domain${NC}"
        echo ""
        echo "Manage clients at: ${CYAN}https://$domain/admin${NC}"
        echo ""
        echo "Share registration tokens with clients to connect."
    else
        local server_url
        server_url=$(grep "^PANGOLIN_SERVER_URL=" "$HESTIA_CONFIG_DIR/.env" | cut -d= -f2)
        
        echo "Your home server is connected to:"
        echo "  ${CYAN}$server_url${NC}"
        echo ""
        echo "Your services are now accessible remotely via the tunnel."
    fi
    
    echo ""
    echo "Useful commands:"
    echo "  ${CYAN}hestia tunnel:status${NC}  - Check tunnel status"
    echo "  ${CYAN}hestia tunnel:logs${NC}     - View tunnel logs"
    echo "  ${CYAN}hestia tunnel:disable${NC}  - Disable tunnel"
    echo ""
}

# Main function
main() {
    check_interactive
    show_welcome
    select_mode
    
    case "$TUNNEL_MODE" in
        server)
            configure_server
            ;;
        client)
            configure_client
            ;;
        *)
            log_error "Unknown mode: $TUNNEL_MODE"
            exit 1
            ;;
    esac
    
    read -p "Start Pangolin now? [Y/n] (Y): " start_now
    start_now=${start_now:-Y}
    
    if [[ "$start_now" =~ ^[Yy]$ ]]; then
        start_pangolin
    else
        echo ""
        log_info "To start later, run: ${CYAN}hestia tunnel:enable${NC}"
    fi
    
    show_completion
}

# If script is run directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
