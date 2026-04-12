#!/bin/bash
# Phase 3: Builder
# - Install OpenClaude (builder agent)
# - Set up intelligence provider configuration
# - Configure A2A bridge
# - Initialize first workspace
#
# Idempotent: Safe to run multiple times

set -euo pipefail

HESTIA_TARGET="${HESTIA_TARGET:-/opt/hestia}"
HESTIA_SAFE_MODE="${HESTIA_SAFE_MODE:-0}"

# State tracking
INSTALL_STATE_FILE="${INSTALL_STATE_FILE:-${HESTIA_TARGET}/.install-state}"
INSTALL_STATE_DIR="${INSTALL_STATE_DIR:-${HESTIA_TARGET}/.install-state.d/phase3}"
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
log_info() { echo -e "${BLUE}[PHASE3]${NC} $1"; }
log_success() { echo -e "${GREEN}[PHASE3]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[PHASE3]${NC} $1"; }
log_error() { echo -e "${RED}[PHASE3]${NC} $1"; }
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
    local total=9  # Total number of steps in phase3 (including optional whodb)
    
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BLUE}  Phase 3 Progress: $completed/$total steps${NC}"
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
}

# ============================================================================
# IDEMPOTENT STEP FUNCTIONS
# ============================================================================

# Detect or configure intelligence provider
configure_intelligence() {
    local step_name="configure_intelligence"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would configure intelligence provider"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Configuring intelligence provider..."
    
    # Check if already configured
    if [[ -f "$HESTIA_TARGET/config/.env" ]]; then
        if grep -q "INTELLIGENCE_PROVIDER=" "$HESTIA_TARGET/config/.env" 2>/dev/null; then
            local existing_provider
            existing_provider=$(grep "^INTELLIGENCE_PROVIDER=" "$HESTIA_TARGET/config/.env" | cut -d= -f2)
            log_info "Intelligence provider already configured: $existing_provider"
            mark_step_completed "$step_name"
            return 0
        fi
    fi
    
    # Check for local Ollama
    if command -v ollama &> /dev/null || curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        log_info "Ollama detected locally"
        INTELLIGENCE_PROVIDER="ollama"
        INTELLIGENCE_ENDPOINT="http://localhost:11434"
        INTELLIGENCE_MODEL="llama3.2"
    else
        # Try to install Ollama
        log_info "Installing Ollama..."
        curl -fsSL https://ollama.com/install.sh | sh
        
        # Start Ollama (idempotent)
        systemctl enable ollama 2>/dev/null || true
        systemctl start ollama 2>/dev/null || true
        
        # Pull a default model
        log_info "Pulling default model (llama3.2)..."
        if command -v ollama &> /dev/null; then
            ollama pull llama3.2 || log_warn "Model pull may have failed, will retry later"
        fi
        
        INTELLIGENCE_PROVIDER="ollama"
        INTELLIGENCE_ENDPOINT="http://localhost:11434"
        INTELLIGENCE_MODEL="llama3.2"
    fi
    
    # Add to environment (append if exists, create if not)
    # First remove old intelligence entries to avoid duplicates
    if [[ -f "$HESTIA_TARGET/config/.env" ]]; then
        sed -i '/^# Intelligence Provider/d' "$HESTIA_TARGET/config/.env"
        sed -i '/^INTELLIGENCE_PROVIDER=/d' "$HESTIA_TARGET/config/.env"
        sed -i '/^INTELLIGENCE_ENDPOINT=/d' "$HESTIA_TARGET/config/.env"
        sed -i '/^INTELLIGENCE_MODEL=/d' "$HESTIA_TARGET/config/.env"
        sed -i '/^INTELLIGENCE_API_KEY=/d' "$HESTIA_TARGET/config/.env"
    fi
    
    # Append new configuration
    cat >> "$HESTIA_TARGET/config/.env" << EOF

# Intelligence Provider (auto-detected)
INTELLIGENCE_PROVIDER=$INTELLIGENCE_PROVIDER
INTELLIGENCE_ENDPOINT=$INTELLIGENCE_ENDPOINT
INTELLIGENCE_MODEL=$INTELLIGENCE_MODEL
INTELLIGENCE_API_KEY=${INTELLIGENCE_API_KEY:-}
EOF
    
    log_success "Intelligence provider configured: $INTELLIGENCE_PROVIDER"
    mark_step_completed "$step_name"
}

# Install OpenClaude
install_openclaude() {
    local step_name="install_openclaude"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would install OpenClaude builder agent"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Installing OpenClaude builder agent..."
    
    local openclaude_dir="$HESTIA_TARGET/packages/openclaude"
    mkdir -p "$openclaude_dir"
    
    # Check if already installed via git
    if [[ -d "$openclaude_dir/.git" ]]; then
        log_info "OpenClaude already cloned, updating..."
        cd "$openclaude_dir"
        git pull || log_warn "Git pull failed, continuing with local version"
    else
        # Check if directory has content (from previous attempt)
        if [[ -f "$openclaude_dir/package.json" ]]; then
            log_info "OpenClaude source already present"
        else
            # Clone OpenClaude repository
            cd "$openclaude_dir"
            git clone https://github.com/synap/openclaude.git . 2>/dev/null || {
                log_warn "Git clone failed, will try npm or Docker version"
            }
        fi
    fi
    
    # Install dependencies if source is available
    if [[ -f "$openclaude_dir/package.json" ]]; then
        cd "$openclaude_dir"
        
        # Only npm install if node_modules doesn't exist or package.json is newer
        if [[ ! -d "$openclaude_dir/node_modules" ]] || [[ "$openclaude_dir/package.json" -nt "$openclaude_dir/node_modules" ]]; then
            log_info "Installing npm dependencies..."
            npm install || log_warn "npm install failed"
        else
            log_info "npm dependencies already up to date"
        fi
        
        # Only build if dist doesn't exist or source is newer
        if [[ ! -d "$openclaude_dir/dist" ]] || [[ -n $(find "$openclaude_dir/src" -newer "$openclaude_dir/dist" 2>/dev/null) ]]; then
            log_info "Building OpenClaude..."
            npm run build || log_warn "npm build failed"
        else
            log_info "Build artifacts already up to date"
        fi
    fi
    
    # Create or update systemd service
    local service_file="/etc/systemd/system/openclaude.service"
    local service_updated=false
    
    if [[ -f "$service_file" ]]; then
        # Check if service file needs update
        if ! grep -q "$HESTIA_TARGET/packages/openclaude" "$service_file" 2>/dev/null; then
            log_info "Updating OpenClaude service file..."
            service_updated=true
        fi
    else
        service_updated=true
    fi
    
    if [[ "$service_updated" == true ]]; then
        cat > "$service_file" << EOF
# OpenClaude Builder Agent Service
# Auto-generated - safe to re-run

[Unit]
Description=OpenClaude - Hestia Builder Agent
After=network.target hestia-synap-backend.service

[Service]
Type=simple
User=hestia
Group=hestia
WorkingDirectory=$openclaude_dir
Environment=HESTIA_HOME=$HESTIA_TARGET
EnvironmentFile=$HESTIA_TARGET/config/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
        
        systemctl daemon-reload 2>/dev/null || true
    fi
    
    systemctl enable openclaude.service 2>/dev/null || true
    
    chown -R hestia:hestia "$openclaude_dir"
    
    log_success "OpenClaude installed"
    mark_step_completed "$step_name"
}

# Configure A2A bridge
configure_a2a() {
    local step_name="configure_a2a"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would configure A2A bridge"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Configuring A2A bridge..."
    
    # Create A2A configuration directory
    mkdir -p "$HESTIA_TARGET/config/a2a"
    
    # Check if config already exists and is correct
    if [[ -f "$HESTIA_TARGET/config/a2a/agents.json" ]]; then
        if grep -q "openclaude" "$HESTIA_TARGET/config/a2a/agents.json" 2>/dev/null; then
            log_info "A2A bridge already configured"
            mark_step_completed "$step_name"
            return 0
        fi
    fi
    
    cat > "$HESTIA_TARGET/config/a2a/agents.json" << 'EOF'
{
  "_comment": "Hestia A2A Bridge Configuration - Auto-generated",
  "agents": [
    {
      "id": "openclaude",
      "name": "OpenClaude Builder",
      "endpoint": "http://localhost:3002",
      "capabilities": ["build", "deploy", "configure"],
      "auth": {
        "type": "api_key",
        "header": "X-API-Key"
      }
    },
    {
      "id": "synap-orchestrator",
      "name": "Synap Orchestrator",
      "endpoint": "http://localhost:3001",
      "capabilities": ["query", "modify", "propose"],
      "auth": {
        "type": "bearer",
        "token_env": "ORCHESTRATOR_TOKEN"
      }
    }
  ],
  "routing": {
    "default_agent": "openclaude",
    "rules": [
      {
        "pattern": "^build|^deploy|^configure",
        "target": "openclaude"
      },
      {
        "pattern": "^query|^search|^modify",
        "target": "synap-orchestrator"
      }
    ]
  }
}
EOF
    
    chown -R hestia:hestia "$HESTIA_TARGET/config/a2a"
    
    log_success "A2A bridge configured"
    mark_step_completed "$step_name"
}

# Create workspace template
create_workspace_template() {
    local step_name="create_workspace_template"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create workspace template"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Creating initial workspace template..."
    
    mkdir -p "$HESTIA_TARGET/templates"
    
    # Check if template already exists
    if [[ -f "$HESTIA_TARGET/templates/initial-workspace.json" ]]; then
        log_info "Workspace template already exists"
        mark_step_completed "$step_name"
        return 0
    fi
    
    cat > "$HESTIA_TARGET/templates/initial-workspace.json" << 'EOF'
{
  "_comment": "Hestia Initial Workspace Template - Auto-generated",
  "name": "My Hestia",
  "description": "Your sovereign AI workspace",
  "profiles": [
    {
      "slug": "task",
      "name": "Task",
      "icon": "check-square",
      "properties": ["title", "status", "priority", "due_date"]
    },
    {
      "slug": "note",
      "name": "Note",
      "icon": "file-text",
      "properties": ["title", "content", "tags"]
    },
    {
      "slug": "project",
      "name": "Project",
      "icon": "folder",
      "properties": ["title", "status", "description"]
    }
  ],
  "views": [
    {
      "name": "All Tasks",
      "type": "table",
      "profile": "task"
    },
    {
      "name": "Notes Board",
      "type": "board",
      "profile": "note"
    }
  ]
}
EOF
    
    chown hestia:hestia "$HESTIA_TARGET/templates/initial-workspace.json"
    
    log_success "Workspace template created"
    mark_step_completed "$step_name"
}

# Update Docker Compose with builder services
update_docker_compose() {
    local step_name="update_docker_compose"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would update Docker Compose with builder services"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Checking Docker Compose for builder services..."
    
    cd "$HESTIA_TARGET"
    
    # Check if builder services are already in docker-compose.yml
    if grep -q "openclaude:" "$HESTIA_TARGET/docker-compose.yml" 2>/dev/null; then
        log_info "Builder services already in Docker Compose"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Adding builder services to Docker Compose..."
    
    # Append builder services to docker-compose.yml
    cat >> "$HESTIA_TARGET/docker-compose.yml" << 'EOF'

  # OpenClaude Builder Agent
  openclaude:
    image: ghcr.io/synap/openclaude:latest
    container_name: hestia-openclaude
    restart: unless-stopped
    depends_on:
      - synap-backend
      - openclaw
    environment:
      HESTIA_HOME: ${HESTIA_HOME}
      SYNAP_BACKEND_URL: http://synap-backend:4000
      OPENCLAW_URL: http://openclaw:8080
      INTELLIGENCE_PROVIDER: ${INTELLIGENCE_PROVIDER}
      INTELLIGENCE_ENDPOINT: ${INTELLIGENCE_ENDPOINT}
      INTELLIGENCE_MODEL: ${INTELLIGENCE_MODEL}
      PORT: 3002
    ports:
      - "3002:3002"
    volumes:
      - ${HESTIA_HOME}/packages:/app/packages
      - ${HESTIA_HOME}/config/a2a:/app/config
      - ${HESTIA_HOME}/logs/openclaude:/app/logs
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - hestia-network

  # A2A Bridge
  a2a-bridge:
    image: ghcr.io/synap/a2a-bridge:latest
    container_name: hestia-a2a-bridge
    restart: unless-stopped
    environment:
      A2A_CONFIG_PATH: /app/config/agents.json
      PORT: 3003
    ports:
      - "3003:3003"
    volumes:
      - ${HESTIA_HOME}/config/a2a:/app/config:ro
    networks:
      - hestia-network
EOF
    
    chown hestia:hestia "$HESTIA_TARGET/docker-compose.yml"
    
    log_success "Builder services added to Docker Compose"
    mark_step_completed "$step_name"
}

# Seed initial data via API
seed_initial_data() {
    local step_name="seed_initial_data"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would seed initial data via API"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Checking if initial data needs to be seeded..."
    
    # Check if already seeded (via state file or API check)
    if [[ -f "$INSTALL_STATE_DIR/seeded" ]]; then
        log_info "Initial data already seeded"
        mark_step_completed "$step_name"
        return 0
    fi
    
    # Wait for backend to be ready
    log_info "Waiting for backend to be ready..."
    local retries=0
    while ! curl -s http://localhost:4000/health > /dev/null 2>&1; do
        retries=$((retries + 1))
        if [[ $retries -gt 30 ]]; then
            log_warn "Backend not ready after 60 seconds, skipping initial data seed"
            mark_step_completed "$step_name"
            return 0
        fi
        sleep 2
    done
    
    # Check if API key exists
    local api_key
    if [[ -f "$HESTIA_TARGET/config/.env" ]]; then
        api_key=$(grep "^API_KEY=" "$HESTIA_TARGET/config/.env" 2>/dev/null | cut -d= -f2)
    fi
    
    if [[ -z "$api_key" ]]; then
        log_warn "API key not found, skipping initial data seed"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Seeding initial data..."
    
    # Create marker file to avoid re-seeding even if this fails
    touch "$INSTALL_STATE_DIR/seeded"
    
    # Attempt to seed via API
    local response
    response=$(curl -s -w "\n%{http_code}" -X POST http://localhost:4000/api/setup/init \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $api_key" \
        -d @"$HESTIA_TARGET/templates/initial-workspace.json" 2>/dev/null || echo -e "\n000")
    
    local http_code=$(echo "$response" | tail -n1)
    
    if [[ "$http_code" == "200" ]] || [[ "$http_code" == "201" ]]; then
        log_success "Initial data seeded successfully"
    elif [[ "$http_code" == "409" ]]; then
        log_info "Initial data already exists (conflict)"
    else
        log_warn "Initial seed returned HTTP $http_code - may need manual setup"
    fi
    
    mark_step_completed "$step_name"
}

# Create management scripts
create_management_scripts() {
    local step_name="create_management_scripts"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create management scripts"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Setting up management scripts..."
    
    mkdir -p "$HESTIA_TARGET/bin"
    
    # Check if wrapper script exists and is correct
    if [[ -f "$HESTIA_TARGET/bin/hestia" ]]; then
        if grep -q "Hestia CLI wrapper" "$HESTIA_TARGET/bin/hestia" 2>/dev/null; then
            log_info "Management scripts already exist"
        else
            log_info "Updating hestia wrapper script..."
        fi
    fi
    
    # hestia wrapper script
    cat > "$HESTIA_TARGET/bin/hestia" << 'EOF'
#!/bin/bash
# Hestia CLI Wrapper
# Auto-generated - safe to re-run

HESTIA_HOME="${HESTIA_HOME:-/opt/hestia}"

# If hestia CLI is installed globally, use it
if command -v hestia &> /dev/null; then
    exec hestia "$@"
fi

# Otherwise, try to use the local installation
if [[ -f "$HESTIA_HOME/packages/cli/dist/hestia.js" ]]; then
    exec node "$HESTIA_HOME/packages/cli/dist/hestia.js" "$@"
fi

echo "Hestia CLI not found. Please run: hestia init"
exit 1
EOF
    
    chmod +x "$HESTIA_TARGET/bin/hestia"
    chown hestia:hestia "$HESTIA_TARGET/bin/hestia"
    
    # Add to PATH (idempotent)
    if [[ ! -f "/usr/local/bin/hestia" ]]; then
        ln -sf "$HESTIA_TARGET/bin/hestia" /usr/local/bin/hestia
        log_info "Created symlink: /usr/local/bin/hestia"
    fi
    
    log_success "Management scripts ready"
    mark_step_completed "$step_name"
}

# Install WhoDB database viewer (optional)
install_whodb() {
    local step_name="install_whodb"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would install WhoDB database viewer"
        mark_step_completed "$step_name"
        return 0
    fi
    
    # Check if already configured via environment variable or state
    local whodb_enabled=${WHODB_ENABLED:-false}
    
    # Interactive prompt if not set
    if [[ "$whodb_enabled" == "false" ]] && [[ -t 0 ]]; then
        echo ""
        echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
        echo -e "${CYAN}  Database Viewer (Optional)${NC}"
        echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
        echo ""
        echo "WhoDB is a lightweight, AI-powered database visualization tool."
        echo ""
        echo "Features:"
        echo "  • Web UI for database inspection and querying"
        echo "  • Visual schema topology with relationship diagrams"
        echo "  • AI-powered natural language queries (requires Ollama)"
        echo "  • Support for PostgreSQL, MySQL, Redis, and more"
        echo "  • Lightweight (<50MB Docker image)"
        echo ""
        echo "When to use:"
        echo "  - Debugging database issues without SQL knowledge"
        echo "  - Exploring unfamiliar database schemas"
        echo "  - Visualizing entity relationships in Synap"
        echo "  - Quick ad-hoc queries during development"
        echo ""
        echo "This is OPTIONAL - not required for core Hestia functionality."
        echo ""
        
        read -p "Enable WhoDB database viewer? [y/N]: " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            whodb_enabled=true
        fi
    fi
    
    if [[ "$whodb_enabled" != "true" ]]; then
        log_info "WhoDB installation skipped (optional)"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Installing WhoDB database viewer..."
    
    # Pull WhoDB image
    log_info "Pulling WhoDB Docker image..."
    if docker pull clidey/whodb:latest 2>/dev/null; then
        log_success "WhoDB image pulled successfully"
    else
        log_warn "Failed to pull WhoDB image, will retry on first use"
    fi
    
    # Copy docker-compose template
    local template_dir="${HESTIA_TARGET}/packages/install/src/templates"
    local compose_template="${template_dir}/whodb-docker-compose.yml"
    local compose_target="${HESTIA_TARGET}/config/docker-compose.whodb.yml"
    
    if [[ -f "$compose_template" ]]; then
        cp "$compose_template" "$compose_target"
        log_info "WhoDB docker-compose template installed"
    else
        log_warn "WhoDB template not found at $compose_template"
        log_info "WhoDB will use default configuration on first start"
    fi
    
    # Create data directories
    mkdir -p "${HESTIA_TARGET}/data/whodb/queries"
    mkdir -p "${HESTIA_TARGET}/data/whodb/settings"
    chown -R hestia:hestia "${HESTIA_TARGET}/data/whodb"
    
    # Create environment file with Synap DB connection
    local whodb_env="${HESTIA_TARGET}/config/whodb.env"
    
    # Read Synap DB credentials if available
    local synap_db_host="postgres"
    local synap_db_port="5432"
    local synap_db_user="synap"
    local synap_db_pass=""
    local synap_db_name="synap"
    
    if [[ -f "${HESTIA_TARGET}/config/.env" ]]; then
        synap_db_host=$(grep "^DATABASE_HOST=" "${HESTIA_TARGET}/config/.env" 2>/dev/null | cut -d= -f2 || echo "postgres")
        synap_db_port=$(grep "^DATABASE_PORT=" "${HESTIA_TARGET}/config/.env" 2>/dev/null | cut -d= -f2 || echo "5432")
        synap_db_user=$(grep "^DATABASE_USER=" "${HESTIA_TARGET}/config/.env" 2>/dev/null | cut -d= -f2 || echo "synap")
        synap_db_pass=$(grep "^DATABASE_PASSWORD=" "${HESTIA_TARGET}/config/.env" 2>/dev/null | cut -d= -f2 || echo "")
        synap_db_name=$(grep "^DATABASE_NAME=" "${HESTIA_TARGET}/config/.env" 2>/dev/null | cut -d= -f2 || echo "synap")
    fi
    
    cat > "$whodb_env" << EOF
# WhoDB Environment Configuration
# Auto-generated by Hestia Phase 3

WHODB_PORT=8081
WHODB_AI_ENABLED=false
WHODB_OLLAMA_MODEL=llama3.2
WHODB_LOG_LEVEL=info
WHODB_SESSION_SECRET=hestia-whodb-$(date +%s)-$(openssl rand -hex 8)

# Synap PostgreSQL connection
SYNAP_DB_HOST=${synap_db_host}
SYNAP_DB_PORT=${synap_db_port}
SYNAP_DB_USER=${synap_db_user}
SYNAP_DB_PASSWORD=${synap_db_pass}
SYNAP_DB_NAME=${synap_db_name}
SYNAP_DB_SSL_MODE=disable

# Redis connection
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Ollama connection (for AI features)
OLLAMA_HOST=http://ollama:11434

# Hestia home path
HESTIA_HOME=${HESTIA_TARGET}
EOF
    
    chown hestia:hestia "$whodb_env"
    chmod 600 "$whodb_env"
    
    log_success "WhoDB configuration created"
    
    # Update Hestia CLI config to mark dbViewer as enabled
    local hestia_config="${HESTIA_TARGET}/config/config.yaml"
    if [[ -f "$hestia_config" ]]; then
        # Use yq if available, otherwise append manually
        if command -v yq &> /dev/null; then
            yq eval '.dbViewer.enabled = true' -i "$hestia_config"
            yq eval '.dbViewer.provider = "whodb"' -i "$hestia_config"
            yq eval '.dbViewer.port = 8081' -i "$hestia_config"
            yq eval '.dbViewer.databases = ["synap-postgres", "synap-redis"]' -i "$hestia_config"
        else
            # Manual YAML update (append if section doesn't exist)
            if ! grep -q "dbViewer:" "$hestia_config" 2>/dev/null; then
                cat >> "$hestia_config" << 'EOF'

dbViewer:
  enabled: true
  provider: whodb
  port: 8081
  aiEnabled: false
  databases:
    - synap-postgres
    - synap-redis
EOF
            fi
        fi
        chown hestia:hestia "$hestia_config"
    fi
    
    log_success "WhoDB installed and configured"
    log_info "  Access URL: http://localhost:8081"
    log_info "  Start with: hestia db:viewer:enable"
    
    mark_step_completed "$step_name"
}

# Install AI Chat UI (optional)
# Provides web-based chat interfaces for interacting with AI backends
install_ai_chat() {
    local step_name="install_ai_chat"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would install AI chat UIs"
        mark_step_completed "$step_name"
        return 0
    fi
    
    # Check if already configured via environment variable
    local ai_chat_enabled=${AI_CHAT_ENABLED:-false}
    local ai_chat_install_all=${AI_CHAT_INSTALL_ALL:-false}
    local install_lobechat=false
    local install_openwebui=false
    local install_librechat=false
    
    # Interactive prompt if not set
    if [[ "$ai_chat_enabled" == "false" ]] && [[ -t 0 ]]; then
        echo ""
        echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
        echo -e "${CYAN}  AI Chat Interface (Optional)${NC}"
        echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
        echo ""
        echo "Add a web-based chat interface for interacting with your AI backend."
        echo "You can install one or more - each offers a different experience."
        echo ""
        echo "Options:"
        echo ""
        echo -e "${GREEN}1. LobeChat${NC} (Recommended for beginners)"
        echo "   Modern, beautiful UI with plugin ecosystem"
        echo "   Best for: Users who want a feature-rich, polished experience"
        echo "   Port: 3010"
        echo ""
        echo -e "${GREEN}2. Open WebUI${NC}"
        echo "   Native Ollama integration with RAG support"
        echo "   Best for: Users who want direct Ollama integration"
        echo "   Port: 3011"
        echo ""
        echo -e "${GREEN}3. LibreChat${NC}"
        echo "   ChatGPT clone with multi-model support"
        echo "   Best for: Users who want a ChatGPT-like experience"
        echo "   Port: 3012"
        echo ""
        echo "You can install multiple and switch between them."
        echo "This is OPTIONAL - not required for core Hestia functionality."
        echo ""
        
        read -p "Install AI chat interface(s)? [y/N]: " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ai_chat_enabled=true
            
            echo ""
            echo "Which AI chat UIs would you like to install?"
            echo ""
            
            read -p "Install LobeChat? [y/N]: " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                install_lobechat=true
            fi
            
            read -p "Install Open WebUI? [y/N]: " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                install_openwebui=true
            fi
            
            read -p "Install LibreChat? [y/N]: " -n 1 -r
            echo ""
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                install_librechat=true
            fi
        fi
    fi
    
    if [[ "$ai_chat_enabled" != "true" ]]; then
        log_info "AI chat installation skipped (optional)"
        mark_step_completed "$step_name"
        return 0
    fi
    
    # Check if any provider was selected
    if [[ "$install_lobechat" == "false" ]] && [[ "$install_openwebui" == "false" ]] && [[ "$install_librechat" == "false" ]]; then
        if [[ "$ai_chat_install_all" == "true" ]]; then
            install_lobechat=true
            install_openwebui=true
            install_librechat=true
        else
            log_info "No AI chat UI selected, skipping installation"
            mark_step_completed "$step_name"
            return 0
        fi
    fi
    
    log_info "Installing AI chat interfaces..."
    
    # Copy AI chat docker-compose template to config directory
    local template_dir="${HESTIA_TARGET}/packages/install/src/templates"
    local compose_template="${template_dir}/ai-chat-docker-compose.yml"
    local compose_target="${HESTIA_TARGET}/config/docker-compose.ai-chat.yml"
    
    if [[ -f "$compose_template" ]]; then
        cp "$compose_template" "$compose_target"
        log_info "AI chat docker-compose template installed"
    else
        log_warn "AI chat template not found at $compose_template"
        log_info "AI chat will use hestia ai:chat:install after setup"
    fi
    
    # Pull Docker images for selected providers
    if [[ "$install_lobechat" == "true" ]]; then
        log_info "Pulling LobeChat image..."
        if docker pull lobehub/lobe-chat:latest 2>/dev/null; then
            log_success "LobeChat image pulled"
        else
            log_warn "Failed to pull LobeChat image, will retry on first start"
        fi
    fi
    
    if [[ "$install_openwebui" == "true" ]]; then
        log_info "Pulling Open WebUI image..."
        if docker pull ghcr.io/open-webui/open-webui:latest 2>/dev/null; then
            log_success "Open WebUI image pulled"
        else
            log_warn "Failed to pull Open WebUI image, will retry on first start"
        fi
    fi
    
    if [[ "$install_librechat" == "true" ]]; then
        log_info "Pulling LibreChat image..."
        if docker pull ghcr.io/danny-avila/librechat:latest 2>/dev/null; then
            log_success "LibreChat image pulled"
        else
            log_warn "Failed to pull LibreChat image, will retry on first start"
        fi
    fi
    
    # Update Hestia CLI config to mark aiChat providers as installed
    local hestia_config="${HESTIA_TARGET}/config/config.yaml"
    if [[ -f "$hestia_config" ]]; then
        # Use yq if available, otherwise append manually
        if command -v yq &> /dev/null; then
            yq eval '.aiChat.providers = []' -i "$hestia_config" 2>/dev/null || true
            
            if [[ "$install_lobechat" == "true" ]]; then
                yq eval '.aiChat.providers += [{"name": "lobechat", "enabled": false, "port": 3010, "url": "http://localhost:3010"}]' -i "$hestia_config"
            fi
            if [[ "$install_openwebui" == "true" ]]; then
                yq eval '.aiChat.providers += [{"name": "openwebui", "enabled": false, "port": 3011, "url": "http://localhost:3011"}]' -i "$hestia_config"
            fi
            if [[ "$install_librechat" == "true" ]]; then
                yq eval '.aiChat.providers += [{"name": "librechat", "enabled": false, "port": 3012, "url": "http://localhost:3012"}]' -i "$hestia_config"
            fi
        else
            # Manual YAML update (append if section doesn't exist)
            if ! grep -q "aiChat:" "$hestia_config" 2>/dev/null; then
                cat >> "$hestia_config" << EOF

aiChat:
  providers:
EOF
                if [[ "$install_lobechat" == "true" ]]; then
                    cat >> "$hestia_config" << 'EOF'
    - name: lobechat
      enabled: false
      port: 3010
      url: http://localhost:3010
EOF
                fi
                if [[ "$install_openwebui" == "true" ]]; then
                    cat >> "$hestia_config" << 'EOF'
    - name: openwebui
      enabled: false
      port: 3011
      url: http://localhost:3011
EOF
                fi
                if [[ "$install_librechat" == "true" ]]; then
                    cat >> "$hestia_config" << 'EOF'
    - name: librechat
      enabled: false
      port: 3012
      url: http://localhost:3012
EOF
                fi
            fi
        fi
        chown hestia:hestia "$hestia_config"
    fi
    
    log_success "AI chat interfaces installed"
    
    # Print summary
    echo ""
    echo -e "${GREEN}Installed AI chat UIs:${NC}"
    if [[ "$install_lobechat" == "true" ]]; then
        echo "  • LobeChat: http://localhost:3010"
        echo "    Start with: hestia ai:chat:start lobechat"
    fi
    if [[ "$install_openwebui" == "true" ]]; then
        echo "  • Open WebUI: http://localhost:3011"
        echo "    Start with: hestia ai:chat:start openwebui"
    fi
    if [[ "$install_librechat" == "true" ]]; then
        echo "  • LibreChat: http://localhost:3012"
        echo "    Start with: hestia ai:chat:start librechat"
    fi
    echo ""
    
    mark_step_completed "$step_name"
}

# Start builder services
start_builder_services() {
    local step_name="start_builder_services"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would start builder services"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Starting builder services..."
    
    cd "$HESTIA_TARGET"
    
    # Start Ollama if installed locally (idempotent)
    if command -v ollama &> /dev/null; then
        if ! systemctl is-active --quiet ollama 2>/dev/null; then
            log_info "Starting local Ollama..."
            systemctl start ollama 2>/dev/null || true
        else
            log_info "Local Ollama already running"
        fi
    fi
    
    # Check if we need Ollama container
    local use_ollama_container=false
    if [[ -f "$HESTIA_TARGET/config/.env" ]]; then
        if grep -q "INTELLIGENCE_ENDPOINT=http://localhost:11434" "$HESTIA_TARGET/config/.env" 2>/dev/null; then
            if ! command -v ollama &> /dev/null && ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
                use_ollama_container=true
            fi
        fi
    fi
    
    # Start Ollama container if needed
    if [[ "$use_ollama_container" == true ]]; then
        if ! docker ps --format '{{.Names}}' | grep -q "hestia-ollama"; then
            log_info "Starting Ollama container..."
            docker run -d \
                --name hestia-ollama \
                --restart unless-stopped \
                -p 11434:11434 \
                -v ollama-data:/root/.ollama \
                ollama/ollama:latest 2>/dev/null || log_warn "Ollama container may already exist or failed"
        else
            log_info "Ollama container already running"
        fi
    fi
    
    # Start OpenClaude via Docker Compose (idempotent)
    log_info "Starting OpenClaude service..."
    
    # First ensure builder services are in compose
    if ! grep -q "openclaude:" "$HESTIA_TARGET/docker-compose.yml" 2>/dev/null; then
        log_warn "OpenClaude not in compose, skipping Docker start"
    else
        docker compose up -d openclaude || log_warn "OpenClaude start may have failed"
        
        # Also try to start A2A bridge
        docker compose up -d a2a-bridge 2>/dev/null || log_info "A2A bridge not in compose yet"
    fi
    
    # Start WhoDB if enabled
    if [[ -f "${HESTIA_TARGET}/config/docker-compose.whodb.yml" ]]; then
        local whodb_enabled=$(grep "^WHODB_ENABLED=true" "${HESTIA_TARGET}/config/.env" 2>/dev/null | cut -d= -f2 || echo "false")
        if [[ "$whodb_enabled" == "true" ]] || grep -q "enabled: true" "${HESTIA_TARGET}/config/config.yaml" 2>/dev/null | grep -q "dbViewer"; then
            log_info "Starting WhoDB database viewer..."
            docker compose -f "${HESTIA_TARGET}/config/docker-compose.whodb.yml" --env-file "${HESTIA_TARGET}/config/whodb.env" up -d 2>/dev/null || log_warn "WhoDB start may have failed"
        fi
    fi
    
    # Start AI chat services if configured
    if [[ -f "${HESTIA_TARGET}/config/docker-compose.ai-chat.yml" ]]; then
        log_info "Starting AI chat services..."
        
        # Check which providers are configured and start them
        if grep -q "name: lobechat" "${HESTIA_TARGET}/config/config.yaml" 2>/dev/null; then
            log_info "Starting LobeChat..."
            docker compose -f "${HESTIA_TARGET}/config/docker-compose.ai-chat.yml" --profile lobechat up -d 2>/dev/null || log_warn "LobeChat start may have failed"
        fi
        
        if grep -q "name: openwebui" "${HESTIA_TARGET}/config/config.yaml" 2>/dev/null; then
            log_info "Starting Open WebUI..."
            docker compose -f "${HESTIA_TARGET}/config/docker-compose.ai-chat.yml" --profile openwebui up -d 2>/dev/null || log_warn "Open WebUI start may have failed"
        fi
        
        if grep -q "name: librechat" "${HESTIA_TARGET}/config/config.yaml" 2>/dev/null; then
            log_info "Starting LibreChat..."
            docker compose -f "${HESTIA_TARGET}/config/docker-compose.ai-chat.yml" --profile librechat up -d 2>/dev/null || log_warn "LibreChat start may have failed"
        fi
    fi
    
    log_success "Builder services started"
    mark_step_completed "$step_name"
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    init_state
    
    log_info "═══════════════════════════════════════"
    log_info "Phase 3: Builder"
    log_info "═══════════════════════════════════════"
    
    # Show progress at start
    show_progress
    
    # Run all steps
    configure_intelligence
    install_openclaude
    configure_a2a
    create_workspace_template
    update_docker_compose
    seed_initial_data
    create_management_scripts
    install_whodb  # Optional database viewer
    install_ai_chat  # Optional AI chat interfaces
    start_builder_services
    
    # Show final progress
    show_progress
    
    log_success "═══════════════════════════════════════"
    log_success "Phase 3 Complete!"
    log_success "═══════════════════════════════════════"
    log_info "Your Hestia is ready!"
    log_info "  - OpenClaude: http://localhost:3002"
    log_info "  - A2A Bridge: http://localhost:3003"
    
    # Check if WhoDB was installed
    if [[ -f "${HESTIA_TARGET}/config/docker-compose.whodb.yml" ]]; then
        log_info "  - WhoDB (Database Viewer): http://localhost:8081"
        log_info "    Start with: hestia db:viewer:enable"
    fi
    
    # Check if AI chat was installed
    if [[ -f "${HESTIA_TARGET}/config/docker-compose.ai-chat.yml" ]]; then
        log_info ""
        log_info "AI Chat Interfaces (manage with 'hestia ai:chat'):"
        if [[ -f "${HESTIA_TARGET}/config/config.yaml" ]]; then
            if grep -q "name: lobechat" "${HESTIA_TARGET}/config/config.yaml" 2>/dev/null; then
                log_info "  - LobeChat: http://localhost:3010"
            fi
            if grep -q "name: openwebui" "${HESTIA_TARGET}/config/config.yaml" 2>/dev/null; then
                log_info "  - Open WebUI: http://localhost:3011"
            fi
            if grep -q "name: librechat" "${HESTIA_TARGET}/config/config.yaml" 2>/dev/null; then
                log_info "  - LibreChat: http://localhost:3012"
            fi
        fi
    fi
    
    log_info ""
    log_info "Next steps:"
    log_info "  1. Run first-fire wizard: hestia init"
    log_info "  2. Access your workspace at: https://localhost"
    log_info ""
    log_info "To re-run: sudo ./install.sh phase3 --force"
}

main "$@"
