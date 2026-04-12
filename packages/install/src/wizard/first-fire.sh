#!/bin/bash
# First-Fire Wizard
# Interactive setup for Hestia after initial installation
# Uses whiptail for TUI dialogs

set -euo pipefail

HESTIA_TARGET="${HESTIA_TARGET:-/opt/hestia}"

# Check if whiptail is available
if ! command -v whiptail &> /dev/null; then
    apt-get update && apt-get install -y whiptail || {
        echo "Cannot install whiptail. Falling back to basic prompts."
        exec bash "$(dirname "$0")/first-fire-basic.sh"
    }
fi

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Whiptail settings
WT_TITLE="Hestia First-Fire Wizard"
WT_HEIGHT=20
WT_WIDTH=70

# Show welcome message
show_welcome() {
    whiptail --title "$WT_TITLE" \
        --msgbox "Welcome to Hestia! 🔥\n\nThis wizard will help you:\n\n• Set up your Hestia node\n• Configure your AI provider\n• Create your first workspace\n• Secure your installation\n\nPress OK to continue." \
        $WT_HEIGHT $WT_WIDTH
}

# Get hearth name
get_hearth_name() {
    local default_name="hearth-$(hostname | cut -d. -f1)"
    
    HEARTH_NAME=$(whiptail --title "$WT_TITLE" \
        --inputbox "Enter a name for your Hestia node:\n\nThis will be used to identify your node in the network." \
        $WT_HEIGHT $WT_WIDTH "$default_name" \
        3>&1 1>&2 2>&3)
    
    if [[ $? -ne 0 ]]; then
        echo "Cancelled"
        exit 1
    fi
    
    if [[ -z "$HEARTH_NAME" ]]; then
        HEARTH_NAME="$default_name"
    fi
}

# Select installation type
select_install_type() {
    local choice
    
    choice=$(whiptail --title "$WT_TITLE" \
        --menu "Choose your installation type:" \
        $WT_HEIGHT $WT_WIDTH 4 \
        "1" "Local - Single node, full control" \
        "2" "Distributed - Multiple nodes (advanced)" \
        "3" "Hybrid - Local + cloud backup" \
        3>&1 1>&2 2>&3)
    
    if [[ $? -ne 0 ]]; then
        echo "Cancelled"
        exit 1
    fi
    
    case $choice in
        1) INSTALL_TYPE="local" ;;
        2) INSTALL_TYPE="distributed" ;;
        3) INSTALL_TYPE="hybrid" ;;
    esac
}

# Configure AI provider
configure_ai_provider() {
    local choice
    
    choice=$(whiptail --title "$WT_TITLE" \
        --menu "Choose your AI provider:\n\nThe intelligence provider will handle all AI queries." \
        15 $WT_WIDTH 5 \
        "1" "Ollama (local, free) - Recommended" \
        "2" "OpenRouter (cloud, multiple models)" \
        "3" "Anthropic Claude" \
        "4" "OpenAI" \
        "5" "Custom provider" \
        3>&1 1>&2 2>&3)
    
    if [[ $? -ne 0 ]]; then
        echo "Cancelled"
        exit 1
    fi
    
    case $choice in
        1)
            AI_PROVIDER="ollama"
            AI_ENDPOINT="http://localhost:11434"
            AI_MODEL="llama3.2"
            ;;
        2)
            AI_PROVIDER="openrouter"
            AI_ENDPOINT="https://openrouter.ai/api/v1"
            AI_MODEL=$(whiptail --inputbox "Enter your OpenRouter API key:" 10 $WT_WIDTH "" 3>&1 1>&2 2>&3)
            ;;
        3)
            AI_PROVIDER="anthropic"
            AI_ENDPOINT="https://api.anthropic.com"
            AI_MODEL="claude-3-haiku-20240307"
            ;;
        4)
            AI_PROVIDER="openai"
            AI_ENDPOINT="https://api.openai.com/v1"
            AI_MODEL="gpt-4o-mini"
            ;;
        5)
            AI_PROVIDER="custom"
            AI_ENDPOINT=$(whiptail --inputbox "Enter custom provider endpoint:" 10 $WT_WIDTH "" 3>&1 1>&2 2>&3)
            AI_MODEL=$(whiptail --inputbox "Enter model name:" 10 $WT_WIDTH "" 3>&1 1>&2 2>&3)
            ;;
    esac
}

# Get API keys
get_api_keys() {
    # Only ask for cloud providers
    if [[ "$AI_PROVIDER" != "ollama" ]]; then
        API_KEY=$(whiptail --passwordbox "Enter your ${AI_PROVIDER} API key:\n\n(Use Tab to move to OK, Space to select)" \
            10 $WT_WIDTH 3>&1 1>&2 2>&3)
        
        if [[ $? -ne 0 ]]; then
            echo "Cancelled"
            exit 1
        fi
    fi
}

# Configure domain
configure_domain() {
    local use_domain
    
    use_domain=$(whiptail --title "$WT_TITLE" \
        --yesno "Do you have a domain name for this Hestia?\n\n(e.g., hestia.example.com)\n\nSelect YES to configure a domain, NO to use IP/localhost." \
        10 $WT_WIDTH \
        3>&1 1>&2 2>&3)
    
    if [[ $? -eq 0 ]]; then
        DOMAIN=$(whiptail --inputbox "Enter your domain name:" 10 $WT_WIDTH "" 3>&1 1>&2 2>&3)
        
        if [[ $? -ne 0 ]]; then
            echo "Cancelled"
            exit 1
        fi
    fi
}

# Enable SSL
configure_ssl() {
    local enable_ssl
    
    if [[ -n "${DOMAIN:-}" ]]; then
        enable_ssl=$(whiptail --title "$WT_TITLE" \
            --yesno "Enable automatic HTTPS with Let's Encrypt?\n\nDomain: $DOMAIN\n\nThis will request a free SSL certificate." \
            12 $WT_WIDTH \
            3>&1 1>&2 2>&3)
        
        if [[ $? -eq 0 ]]; then
            ENABLE_SSL="true"
            
            # Check if certbot is installed
            if ! command -v certbot &> /dev/null; then
                whiptail --infobox "Installing certbot..." 5 $WT_WIDTH
                apt-get update && apt-get install -y certbot python3-certbot-nginx
            fi
        fi
    fi
}

# Create admin account
create_admin() {
    whiptail --title "$WT_TITLE" \
        --msgbox "Now let's create your admin account.\n\nThis will be the primary user for your Hestia workspace." \
        10 $WT_WIDTH
    
    ADMIN_EMAIL=$(whiptail --inputbox "Enter your email address:" 10 $WT_WIDTH "" 3>&1 1>&2 2>&3)
    
    if [[ $? -ne 0 ]]; then
        echo "Cancelled"
        exit 1
    fi
    
    while true; do
        ADMIN_PASSWORD=$(whiptail --passwordbox "Create a password:\n\n(Minimum 8 characters)" 10 $WT_WIDTH 3>&1 1>&2 2>&3)
        
        if [[ $? -ne 0 ]]; then
            echo "Cancelled"
            exit 1
        fi
        
        if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
            whiptail --msgbox "Password must be at least 8 characters." 8 $WT_WIDTH
            continue
        fi
        
        local confirm
        confirm=$(whiptail --passwordbox "Confirm your password:" 10 $WT_WIDTH 3>&1 1>&2 2>&3)
        
        if [[ "$ADMIN_PASSWORD" == "$confirm" ]]; then
            break
        else
            whiptail --msgbox "Passwords do not match. Please try again." 8 $WT_WIDTH
        fi
    done
}

# Show summary and confirm
show_summary() {
    local summary
    summary="Configuration Summary:\n\n"
    summary+="Hearth Name: $HEARTH_NAME\n"
    summary+="Installation Type: $INSTALL_TYPE\n"
    summary+="AI Provider: $AI_PROVIDER\n"
    [[ -n "${DOMAIN:-}" ]] && summary+="Domain: $DOMAIN\n"
    [[ -n "${ENABLE_SSL:-}" ]] && summary+="SSL: Enabled (Let's Encrypt)\n"
    [[ -n "${OPTIONAL_SERVICES:-}" ]] && summary+="Optional Services: ${OPTIONAL_SERVICES}\n"
    summary+="Admin Email: $ADMIN_EMAIL\n\n"
    summary+="Is this correct?"
    
    whiptail --title "$WT_TITLE" \
        --yesno "$summary" 18 $WT_WIDTH
    
    if [[ $? -ne 0 ]]; then
        # Go back to start
        return 1
    fi
    
    return 0
}

# Apply configuration
apply_configuration() {
    whiptail --infobox "Applying configuration...\n\nPlease wait." 8 $WT_WIDTH
    
    # Update config files
    local env_file="$HESTIA_TARGET/config/.env"
    
    # Add configuration
    cat >> "$env_file" << EOF

# First-Fire Configuration
HEARTH_NAME=${HEARTH_NAME}
HEARTH_ID=${HEARTH_NAME// /-}
INSTALL_TYPE=${INSTALL_TYPE}
DOMAIN=${DOMAIN:-}
ENABLE_SSL=${ENABLE_SSL:-false}

# AI Provider
INTELLIGENCE_PROVIDER=${AI_PROVIDER}
INTELLIGENCE_ENDPOINT=${AI_ENDPOINT}
INTELLIGENCE_MODEL=${AI_MODEL}
INTELLIGENCE_API_KEY=${API_KEY:-}

# Admin
ADMIN_EMAIL=${ADMIN_EMAIL}
EOF

    # Configure tunnel if enabled
    if [[ -n "${ENABLE_TUNNEL:-}" ]]; then
        log_info "Configuring tunnel..."
        
        # Generate WireGuard keys
        local wg_private_key wg_public_key
        if command -v wg &> /dev/null; then
            wg_private_key=$(wg genkey 2>/dev/null || openssl rand -base64 44)
            wg_public_key=$(echo "$wg_private_key" | wg pubkey 2>/dev/null || openssl rand -base64 44)
        else
            wg_private_key=$(openssl rand -base64 44)
            wg_public_key=$(openssl rand -base64 44)
        fi
        
        cat >> "$env_file" << EOF

# Tunnel Configuration
TUNNEL_MODE=${ENABLE_TUNNEL}
PANGOLIN_WG_PRIVATE_KEY=${wg_private_key}
PANGOLIN_WG_PUBLIC_KEY=${wg_public_key}
EOF
        
        if [[ "$ENABLE_TUNNEL" == "server" ]]; then
            local api_key
            api_key=$(openssl rand -hex 32)
            cat >> "$env_file" << EOF
PANGOLIN_DOMAIN=${TUNNEL_DOMAIN}
PANGOLIN_BASE_URL=https://${TUNNEL_DOMAIN}
PANGOLIN_API_KEY=${api_key}
PANGOLIN_SERVER_PORT=3000
PANGOLIN_WG_PORT=51820
TUNNEL_TOKEN=${TUNNEL_TOKEN}
EOF
        else
            cat >> "$env_file" << EOF
PANGOLIN_SERVER_URL=${TUNNEL_SERVER}
PANGOLIN_CLIENT_TOKEN=${TUNNEL_CLIENT_TOKEN}
PANGOLIN_CLIENT_NAME=${HEARTH_NAME}
PANGOLIN_TUNNELS=synap:4000,openclaw:8080
EOF
        fi
        
        log_success "Tunnel configured for ${ENABLE_TUNNEL} mode"
    fi
    
    # Configure SSL if requested
    if [[ -n "${ENABLE_SSL:-}" ]] && [[ -n "${DOMAIN:-}" ]]; then
        whiptail --infobox "Requesting SSL certificate...\n\nThis may take a minute." 8 $WT_WIDTH
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$ADMIN_EMAIL" || {
            whiptail --msgbox "SSL certificate request failed.\n\nYou can retry later with:\n  certbot --nginx -d $DOMAIN" 10 $WT_WIDTH
        }
    fi
    
    # Create admin via API
    local api_key=$(grep API_KEY "$env_file" | head -1 | cut -d= -f2)
    
    curl -s -X POST http://localhost:4000/api/users \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $api_key" \
        -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"role\":\"admin\"}" > /dev/null 2>&1 || {
        whiptail --msgbox "Admin account creation may have failed.\n\nYou can create it manually via the web interface." 10 $WT_WIDTH
    }
    
    sleep 2
}

# Completion message
show_completion() {
    local message
    message="🎉 Hestia is ready!\n\n"
    message+="Your Hestia node '${HEARTH_NAME}' has been configured.\n\n"
    message+="Access your workspace:\n"
    
    if [[ -n "${DOMAIN:-}" ]]; then
        message+"  https://${DOMAIN}\n\n"
    else
        message+"  http://$(hostname -I | awk '{print $1}')\n"
        message+"  https://localhost (self-signed)\n\n"
    fi
    
    message+="CLI Commands:\n"
    message+"  hestia status     - Check system status\n"
    message+"  hestia ignite     - Start all services\n"
    message+"  hestia add <pkg>  - Add a package\n"
    
    # Add tunnel info if configured
    if [[ -n "${ENABLE_TUNNEL:-}" ]]; then
        message+"  hestia tunnel     - Manage remote access\n"
        
        if [[ "$ENABLE_TUNNEL" == "server" ]]; then
            message+"\nTunnel Server: https://${TUNNEL_DOMAIN}\n"
            message+"Token: ${TUNNEL_TOKEN:0:16}...\n"
        else
            message+"\nConnected to: ${TUNNEL_SERVER}\n"
        fi
    fi
    
    message+"\nDocumentation: https://docs.hestia.dev\n"
    message+"Community: https://community.hestia.dev\n\n"
    
    message+"Enjoy your sovereign AI infrastructure! 🔥"
    
    whiptail --title "$WT_TITLE - Complete!" \
        --msgbox "$message" 20 $WT_WIDTH
}

# Prompt for remote tunnel access
configure_tunnel() {
    local enable_tunnel
    
    whiptail --title "$WT_TITLE - Remote Access" \
        --yesno "Enable remote tunnel access?\n\nThis allows you to access your Hestia from anywhere, even behind CGNAT.\n\nUses Pangolin (self-hosted WireGuard-based tunnel).\n\nSelect YES to configure, NO to skip (can be enabled later)." \
        14 $WT_WIDTH
    
    if [[ $? -eq 0 ]]; then
        # User wants to enable tunnel
        local choice
        choice=$(whiptail --title "$WT_TITLE - Tunnel Mode" \
            --menu "Select tunnel mode:" \
            12 $WT_WIDTH 2 \
            "1" "SERVER - I have a VPS with public IP" \
            "2" "CLIENT - My server is behind CGNAT/firewall" \
            3>&1 1>&2 2>&3)
        
        if [[ $? -eq 0 ]]; then
            case "$choice" in
                1)
                    ENABLE_TUNNEL="server"
                    # Get server configuration
                    TUNNEL_DOMAIN=$(whiptail --inputbox "Tunnel domain (e.g., tunnel.example.com):" 10 $WT_WIDTH "tunnel.${DOMAIN:-example.com}" 3>&1 1>&2 2>&3)
                    TUNNEL_TOKEN=$(openssl rand -hex 16)
                    ;;
                2)
                    ENABLE_TUNNEL="client"
                    # Get server details
                    TUNNEL_SERVER=$(whiptail --inputbox "Pangolin Server URL (e.g., https://tunnel.example.com):" 10 $WT_WIDTH "" 3>&1 1>&2 2>&3)
                    TUNNEL_CLIENT_TOKEN=$(whiptail --inputbox "Registration token from server:" 10 $WT_WIDTH "" 3>&1 1>&2 2>&3)
                    ;;
            esac
        fi
    fi
}

# Configure optional services
configure_optional_services() {
    # Check if services were pre-selected via environment variable
    if [[ -n "${HESTIA_PRESELECTED_SERVICES:-}" ]]; then
        log_info "Using pre-selected services: $HESTIA_PRESELECTED_SERVICES"
        IFS=',' read -ra SELECTED_SERVICES <<< "$HESTIA_PRESELECTED_SERVICES"
        OPTIONAL_SERVICES="${HESTIA_PRESELECTED_SERVICES}"
        return 0
    fi
    
    # Show optional services checklist
    local services_selected
    services_selected=$(whiptail --title "$WT_TITLE - Optional Services" \
        --checklist "Select optional services to install:\n\nUse Space to select/deselect, Tab to move to OK." \
        20 $WT_WIDTH 8 \
        "traefik" "Reverse Proxy: Traefik (alternative to Nginx)" OFF \
        "pangolin" "Remote Tunnel: Pangolin (for home servers)" OFF \
        "whodb" "Database Viewer: WhoDB (web UI for database)" OFF \
        "lobechat" "AI Chat UI: LobeChat (modern chat interface)" OFF \
        "openwebui" "AI Chat UI: Open WebUI (Ollama native)" OFF \
        "librechat" "AI Chat UI: LibreChat (ChatGPT-like)" OFF \
        3>&1 1>&2 2>&3)
    
    # Clean up the selection (remove quotes that whiptail adds)
    services_selected=$(echo "$services_selected" | tr -d '"')
    
    OPTIONAL_SERVICES="$services_selected"
    SELECTED_SERVICES=()
    
    if [[ -n "$services_selected" ]]; then
        IFS=' ' read -ra SELECTED_SERVICES <<< "$services_selected"
    fi
}

# Install selected optional services
install_selected_services() {
    if [[ -z "${OPTIONAL_SERVICES:-}" ]] || [[ ${#SELECTED_SERVICES[@]} -eq 0 ]]; then
        return 0
    fi
    
    whiptail --infobox "Installing optional services...\n\nPlease wait." 10 $WT_WIDTH
    
    # Ensure hestia CLI is available
    if ! command -v hestia &> /dev/null; then
        whiptail --msgbox "hestia CLI not found in PATH.\n\nYou can install services later with:\n  hestia services:install <name>" 12 $WT_WIDTH
        return 0
    fi
    
    local install_log="$HESTIA_TARGET/logs/optional-services-install.log"
    mkdir -p "$(dirname "$install_log")"
    
    local failed_services=()
    local installed_services=()
    
    for service in "${SELECTED_SERVICES[@]}"; do
        service=$(echo "$service" | xargs)  # Trim whitespace
        
        echo "Installing $service..." >> "$install_log"
        
        if hestia services:install "$service" --yes >> "$install_log" 2>&1; then
            echo "Enabling $service..." >> "$install_log"
            if hestia services:enable "$service" >> "$install_log" 2>&1; then
                installed_services+=("$service")
            else
                failed_services+=("$service (enable failed)")
            fi
        else
            failed_services+=("$service (install failed)")
        fi
    done
    
    # Show results
    local result_msg="Optional Services Installation Complete\n\n"
    
    if [[ ${#installed_services[@]} -gt 0 ]]; then
        result_msg+="✓ Installed:\n"
        for svc in "${installed_services[@]}"; do
            result_msg+="  - $svc\n"
        done
    fi
    
    if [[ ${#failed_services[@]} -gt 0 ]]; then
        result_msg+="\n✗ Failed:\n"
        for svc in "${failed_services[@]}"; do
            result_msg+="  - $svc\n"
        done
        result_msg+="\nCheck log for details:\n$install_log"
    fi
    
    whiptail --msgbox "$result_msg" 18 $WT_WIDTH
}

# Update summary to include optional services
update_summary_with_services() {
    if [[ -n "${OPTIONAL_SERVICES:-}" ]]; then
        summary+="\nOptional Services: ${OPTIONAL_SERVICES}\n"
    fi
}

# Main flow
main() {
    show_welcome
    
    while true; do
        get_hearth_name
        select_install_type
        configure_ai_provider
        get_api_keys
        configure_domain
        configure_ssl
        configure_tunnel
        configure_optional_services
        create_admin
        
        if show_summary; then
            break
        fi
    done
    
    apply_configuration
    install_selected_services
    show_completion
    
    # Clear screen and show final message
    clear
    echo -e "${GREEN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║              Hestia Setup Complete! 🔥                          ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "Hearth: ${BLUE}${HEARTH_NAME}${NC}"
    echo -e "Provider: ${BLUE}${AI_PROVIDER}${NC}"
    [[ -n "${DOMAIN:-}" ]] && echo -e "Domain: ${BLUE}${DOMAIN}${NC}"
    
    if [[ -n "${OPTIONAL_SERVICES:-}" ]]; then
        echo -e "Services: ${BLUE}${OPTIONAL_SERVICES}${NC}"
    fi
    
    echo ""
    echo "Run 'hestia status' to check your system."
}

main "$@"
