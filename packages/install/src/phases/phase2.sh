#!/bin/bash
# Phase 2: Core + Gateway
# - Install Synap Backend (temporal knowledge graph)
# - Install OpenClaw (multi-channel gateway)
# - Set up PostgreSQL with pgvector
# - Configure reverse proxy (Nginx or Traefik)
# - Create Docker Compose stack
#
# Idempotent: Safe to run multiple times

set -euo pipefail

HESTIA_TARGET="${HESTIA_TARGET:-/opt/hestia}"
HESTIA_SAFE_MODE="${HESTIA_SAFE_MODE:-0}"
HESTIA_REVERSE_PROXY="${HESTIA_REVERSE_PROXY:-nginx}"  # nginx or traefik

# State tracking
INSTALL_STATE_FILE="${INSTALL_STATE_FILE:-${HESTIA_TARGET}/.install-state}"
INSTALL_STATE_DIR="${INSTALL_STATE_DIR:-${HESTIA_TARGET}/.install-state.d/phase2}"
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
log_info() { echo -e "${BLUE}[PHASE2]${NC} $1"; }
log_success() { echo -e "${GREEN}[PHASE2]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[PHASE2]${NC} $1"; }
log_error() { echo -e "${RED}[PHASE2]${NC} $1"; }
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
    local total=6  # Total number of steps in phase2
    
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BLUE}  Phase 2 Progress: $completed/$total steps${NC}"
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
}

# ============================================================================
# IDEMPOTENT STEP FUNCTIONS
# ============================================================================

# Generate secure passwords
generate_password() {
    openssl rand -base64 32 | tr -d '=+/' | cut -c1-24
}

# Create environment files
create_env_files() {
    local step_name="create_env_files"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create environment files at $HESTIA_TARGET/config/.env"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Creating environment files..."
    
    # Check if .env already exists and has content
    if [[ -f "$HESTIA_TARGET/config/.env" ]] && [[ -s "$HESTIA_TARGET/config/.env" ]]; then
        log_info "Environment file already exists"
        
        # In safe mode, don't overwrite
        if [[ "$HESTIA_SAFE_MODE" == "1" ]]; then
            log_info "Safe mode - preserving existing .env"
            mark_step_completed "$step_name"
            return 0
        fi
        
        # Backup existing
        cp "$HESTIA_TARGET/config/.env" "$HESTIA_TARGET/config/.env.backup.$(date +%s)"
        log_info "Backed up existing .env file"
    fi
    
    # Generate passwords (only if not already present)
    local POSTGRES_PASSWORD JWT_SECRET API_KEY TYPESENSE_API_KEY
    
    if [[ -f "$HESTIA_TARGET/config/.env" ]]; then
        # Extract existing passwords to preserve them
        POSTGRES_PASSWORD=$(grep "^POSTGRES_PASSWORD=" "$HESTIA_TARGET/config/.env" 2>/dev/null | cut -d= -f2 || generate_password)
        JWT_SECRET=$(grep "^JWT_SECRET=" "$HESTIA_TARGET/config/.env" 2>/dev/null | cut -d= -f2 || generate_password)
        API_KEY=$(grep "^API_KEY=" "$HESTIA_TARGET/config/.env" 2>/dev/null | cut -d= -f2 || generate_password)
        TYPESENSE_API_KEY=$(grep "^TYPESENSE_API_KEY=" "$HESTIA_TARGET/config/.env" 2>/dev/null | cut -d= -f2 || generate_password)
    else
        POSTGRES_PASSWORD=$(generate_password)
        JWT_SECRET=$(generate_password)
        API_KEY=$(generate_password)
        TYPESENSE_API_KEY=$(generate_password)
    fi
    
    # Main .env file
    cat > "$HESTIA_TARGET/config/.env" << EOF
# Hestia Environment Configuration
# Auto-generated - safe to re-run
# Generated: $(date -Iseconds)

# Database
POSTGRES_USER=hestia
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=hestia
DATABASE_URL=postgresql://hestia:${POSTGRES_PASSWORD}@postgres:5432/hestia

# Search
TYPESENSE_API_KEY=$TYPESENSE_API_KEY
TYPESENSE_NODES=http://typesense:8108

# Security
JWT_SECRET=$JWT_SECRET
API_KEY=$API_KEY

# Service URLs
SYNAP_BACKEND_URL=http://localhost:4000
SYNAP_FRONTEND_URL=http://localhost:3000
OPENCLAW_URL=http://localhost:8080

# Intelligence Hub (optional external provider)
INTELLIGENCE_HUB_URL=
INTELLIGENCE_HUB_API_KEY=

# Paths
HESTIA_HOME=$HESTIA_TARGET
DATA_DIR=$HESTIA_TARGET/data
LOGS_DIR=$HESTIA_TARGET/logs

# Feature flags
ENABLE_VECTOR_SEARCH=true
ENABLE_REALTIME_SYNC=true
ENABLE_PROACTIVE_AI=false
EOF
    
    chmod 600 "$HESTIA_TARGET/config/.env"
    chown hestia:hestia "$HESTIA_TARGET/config/.env"
    
    log_success "Environment files created"
    mark_step_completed "$step_name"
}

# Create Docker Compose configuration
create_docker_compose() {
    local step_name="create_docker_compose"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create Docker Compose configuration"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Creating Docker Compose configuration..."
    
    # Backup existing if present and different
    if [[ -f "$HESTIA_TARGET/docker-compose.yml" ]]; then
        if [[ "$HESTIA_SAFE_MODE" == "1" ]]; then
            log_info "Safe mode - preserving existing docker-compose.yml"
            mark_step_completed "$step_name"
            return 0
        fi
        
        # Check if it's a Hestia compose file
        if grep -q "hestia-network" "$HESTIA_TARGET/docker-compose.yml" 2>/dev/null; then
            log_info "Docker Compose file already exists and is correct"
            
            # Check if we need to update it (compare content hash)
            local existing_hash new_hash
            existing_hash=$(md5sum "$HESTIA_TARGET/docker-compose.yml" 2>/dev/null | cut -d' ' -f1)
            
            # Create temp file with new content to compare
            new_hash=$(cat << 'EOF' | md5sum | cut -d' ' -f1
version: '3.8'

services:
  # PostgreSQL with pgvector
  postgres:
    image: ankane/pgvector:latest
    container_name: hestia-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-hestia}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: \${POSTGRES_DB:-hestia}
    volumes:
      - \${DATA_DIR}/postgres:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - hestia-network

  # Typesense (search engine)
  typesense:
    image: typesense/typesense:0.25.1
    container_name: hestia-typesense
    restart: unless-stopped
    environment:
      TYPESENSE_API_KEY: \${TYPESENSE_API_KEY:-typesense-api-key}
      TYPESENSE_DATA_DIR: /data
    volumes:
      - \${DATA_DIR}/typesense:/data
    ports:
      - "8108:8108"
    networks:
      - hestia-network

  # Redis (caching, sessions, job queue)
  redis:
    image: redis:7-alpine
    container_name: hestia-redis
    restart: unless-stopped
    volumes:
      - \${DATA_DIR}/redis:/data
    ports:
      - "6379:6379"
    networks:
      - hestia-network

  # Synap Backend (temporal knowledge graph)
  synap-backend:
    image: ghcr.io/synap/synap-backend:latest
    container_name: hestia-synap-backend
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
      typesense:
        condition: service_started
    environment:
      DATABASE_URL: \${DATABASE_URL}
      REDIS_URL: redis://redis:6379
      TYPESENSE_API_KEY: \${TYPESENSE_API_KEY:-typesense-api-key}
      TYPESENSE_NODES: http://typesense:8108
      JWT_SECRET: \${JWT_SECRET}
      API_KEY: \${API_KEY}
      PORT: 4000
      NODE_ENV: production
    ports:
      - "4000:4000"
    volumes:
      - \${DATA_DIR}/uploads:/app/uploads
      - \${LOGS_DIR}/backend:/app/logs
    networks:
      - hestia-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # OpenClaw (multi-channel gateway)
  openclaw:
    image: ghcr.io/synap/openclaw:latest
    container_name: hestia-openclaw
    restart: unless-stopped
    depends_on:
      - synap-backend
      - redis
    environment:
      SYNAP_BACKEND_URL: http://synap-backend:4000
      SYNAP_API_KEY: \${API_KEY}
      REDIS_URL: redis://redis:6379
      PORT: 8080
      NODE_ENV: production
    ports:
      - "8080:8080"
    volumes:
      - \${DATA_DIR}/openclaw:/app/data
      - \${LOGS_DIR}/openclaw:/app/logs
    networks:
      - hestia-network

  # Nginx reverse proxy
  nginx:
    image: nginx:alpine
    container_name: hestia-nginx
    restart: unless-stopped
    depends_on:
      - synap-backend
      - openclaw
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./config/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./config/nginx/ssl:/etc/nginx/ssl:ro
      - \${DATA_DIR}/nginx/cache:/var/cache/nginx
    networks:
      - hestia-network

networks:
  hestia-network:
    driver: bridge

volumes:
  postgres-data:
  typesense-data:
  redis-data:
EOF
            )
            
            if [[ "$existing_hash" == "$new_hash" ]]; then
                log_info "Docker Compose file is up to date"
                mark_step_completed "$step_name"
                return 0
            fi
        fi
        
        # Backup existing
        mv "$HESTIA_TARGET/docker-compose.yml" "$HESTIA_TARGET/docker-compose.yml.backup.$(date +%s)"
        log_info "Backed up existing docker-compose.yml"
    fi
    
    cat > "$HESTIA_TARGET/docker-compose.yml" << 'EOF'
version: '3.8'

services:
  # PostgreSQL with pgvector
  postgres:
    image: ankane/pgvector:latest
    container_name: hestia-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-hestia}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-hestia}
    volumes:
      - ${DATA_DIR}/postgres:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - hestia-network

  # Typesense (search engine)
  typesense:
    image: typesense/typesense:0.25.1
    container_name: hestia-typesense
    restart: unless-stopped
    environment:
      TYPESENSE_API_KEY: ${TYPESENSE_API_KEY:-typesense-api-key}
      TYPESENSE_DATA_DIR: /data
    volumes:
      - ${DATA_DIR}/typesense:/data
    ports:
      - "8108:8108"
    networks:
      - hestia-network

  # Redis (caching, sessions, job queue)
  redis:
    image: redis:7-alpine
    container_name: hestia-redis
    restart: unless-stopped
    volumes:
      - ${DATA_DIR}/redis:/data
    ports:
      - "6379:6379"
    networks:
      - hestia-network

  # Synap Backend (temporal knowledge graph)
  synap-backend:
    image: ghcr.io/synap/synap-backend:latest
    container_name: hestia-synap-backend
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
      typesense:
        condition: service_started
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: redis://redis:6379
      TYPESENSE_API_KEY: ${TYPESENSE_API_KEY:-typesense-api-key}
      TYPESENSE_NODES: http://typesense:8108
      JWT_SECRET: ${JWT_SECRET}
      API_KEY: ${API_KEY}
      PORT: 4000
      NODE_ENV: production
    ports:
      - "4000:4000"
    volumes:
      - ${DATA_DIR}/uploads:/app/uploads
      - ${LOGS_DIR}/backend:/app/logs
    networks:
      - hestia-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # OpenClaw (multi-channel gateway)
  openclaw:
    image: ghcr.io/synap/openclaw:latest
    container_name: hestia-openclaw
    restart: unless-stopped
    depends_on:
      - synap-backend
      - redis
    environment:
      SYNAP_BACKEND_URL: http://synap-backend:4000
      SYNAP_API_KEY: ${API_KEY}
      REDIS_URL: redis://redis:6379
      PORT: 8080
      NODE_ENV: production
    ports:
      - "8080:8080"
    volumes:
      - ${DATA_DIR}/openclaw:/app/data
      - ${LOGS_DIR}/openclaw:/app/logs
    networks:
      - hestia-network

  # Nginx reverse proxy
  nginx:
    image: nginx:alpine
    container_name: hestia-nginx
    restart: unless-stopped
    depends_on:
      - synap-backend
      - openclaw
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./config/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./config/nginx/ssl:/etc/nginx/ssl:ro
      - ${DATA_DIR}/nginx/cache:/var/cache/nginx
    networks:
      - hestia-network

networks:
  hestia-network:
    driver: bridge

volumes:
  postgres-data:
  typesense-data:
  redis-data:
EOF
    
    chown hestia:hestia "$HESTIA_TARGET/docker-compose.yml"
    
    log_success "Docker Compose configuration created"
    mark_step_completed "$step_name"
}

# Create Nginx configuration
create_nginx_config() {
    local step_name="create_nginx_config"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create Nginx configuration"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Creating Nginx configuration..."
    
    mkdir -p "$HESTIA_TARGET/config/nginx"
    
    # Check if config already exists and is correct
    if [[ -f "$HESTIA_TARGET/config/nginx/nginx.conf" ]]; then
        if grep -q "hestia-network" "$HESTIA_TARGET/config/nginx/nginx.conf" 2>/dev/null; then
            log_info "Nginx configuration already exists"
            mark_step_completed "$step_name"
            return 0
        fi
    fi
    
    cat > "$HESTIA_TARGET/config/nginx/nginx.conf" << 'EOF'
# Hestia Nginx Configuration
# Auto-generated - safe to re-run

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript;

    # Upstream definitions
    upstream synap_backend {
        server synap-backend:4000;
    }

    upstream openclaw {
        server openclaw:8080;
    }

    # HTTP server (redirect to HTTPS)
    server {
        listen 80;
        server_name _;
        
        location / {
            return 301 https://$host$request_uri;
        }
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name _;

        # SSL certificates (self-signed by default)
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;

        # SSL settings
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        # Proxy settings
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Synap Backend API
        location /api/ {
            proxy_pass http://synap_backend/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }

        # OpenClaw Gateway
        location /gateway/ {
            proxy_pass http://openclaw/;
            proxy_http_version 1.1;
        }

        # Health check
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }
}
EOF
    
    # Generate self-signed SSL certificate (idempotent)
    mkdir -p "$HESTIA_TARGET/config/nginx/ssl"
    if [[ ! -f "$HESTIA_TARGET/config/nginx/ssl/cert.pem" ]] || [[ ! -f "$HESTIA_TARGET/config/nginx/ssl/key.pem" ]]; then
        log_info "Generating self-signed SSL certificate..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$HESTIA_TARGET/config/nginx/ssl/key.pem" \
            -out "$HESTIA_TARGET/config/nginx/ssl/cert.pem" \
            -subj "/C=US/ST=State/L=City/O=Hestia/CN=localhost" \
            2>/dev/null || true
        chmod 600 "$HESTIA_TARGET/config/nginx/ssl/key.pem"
    else
        log_info "SSL certificates already exist"
    fi
    
    chown -R hestia:hestia "$HESTIA_TARGET/config/nginx"
    
    log_success "Nginx configuration created"
    mark_step_completed "$step_name"
}

# Create initialization scripts
create_init_scripts() {
    local step_name="create_init_scripts"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create database initialization scripts"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Creating database initialization scripts..."
    
    mkdir -p "$HESTIA_TARGET/init-scripts"
    
    # Check if scripts already exist
    if [[ -f "$HESTIA_TARGET/init-scripts/01-enable-pgvector.sql" ]]; then
        log_info "Initialization scripts already exist"
        mark_step_completed "$step_name"
        return 0
    fi
    
    # Enable pgvector extension
    cat > "$HESTIA_TARGET/init-scripts/01-enable-pgvector.sql" << 'EOF'
-- Hestia Database Initialization
-- Auto-generated - safe to re-run

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create application user (separate from admin) - idempotent
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hestia_app') THEN
        CREATE USER hestia_app WITH PASSWORD 'hestia_app_pass';
    END IF;
END
$$;

-- Grant privileges (idempotent)
GRANT CONNECT ON DATABASE hestia TO hestia_app;
GRANT USAGE ON SCHEMA public TO hestia_app;
GRANT CREATE ON SCHEMA public TO hestia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hestia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO hestia_app;
EOF
    
    chown -R hestia:hestia "$HESTIA_TARGET/init-scripts"
    
    log_success "Initialization scripts created"
    mark_step_completed "$step_name"
}

# Pull and start core services
start_core_services() {
    local step_name="start_core_services"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would start core Docker services"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Starting core services..."
    
    cd "$HESTIA_TARGET"
    
    # Pull images (idempotent - will skip if up to date)
    log_info "Pulling Docker images..."
    docker compose pull || {
        log_warn "Some images failed to pull, will use local builds if available"
    }
    
    # Check which services are already running
    local running_services
    running_services=$(docker compose ps --services --filter "status=running" 2>/dev/null || echo "")
    
    if [[ -n "$running_services" ]]; then
        log_info "Some services already running: $running_services"
    fi
    
    # Start infrastructure services first (idempotent)
    log_info "Starting infrastructure services..."
    docker compose up -d postgres redis typesense
    
    # Wait for database to be ready
    log_info "Waiting for database to be ready..."
    local retries=0
    while ! docker compose exec -T postgres pg_isready -U hestia > /dev/null 2>&1; do
        retries=$((retries + 1))
        if [[ $retries -gt 30 ]]; then
            log_warn "Database not ready after 30 attempts, continuing anyway..."
            break
        fi
        sleep 1
    done
    
    # Start application services (idempotent)
    log_info "Starting application services..."
    docker compose up -d synap-backend openclaw nginx
    
    log_success "Core services started"
    
    # Show status
    log_info "Service status:"
    docker compose ps
    
    mark_step_completed "$step_name"
}

# ============================================================================
# REVERSE PROXY CONFIGURATION
# ============================================================================

# Configure reverse proxy selection
detect_reverse_proxy() {
    # Check environment variable first
    if [[ -n "${HESTIA_REVERSE_PROXY:-}" ]]; then
        echo "$HESTIA_REVERSE_PROXY"
        return 0
    fi
    
    # Check config file
    if [[ -f "$HESTIA_TARGET/config/.env" ]]; then
        local proxy_from_env
        proxy_from_env=$(grep "^HESTIA_REVERSE_PROXY=" "$HESTIA_TARGET/config/.env" 2>/dev/null | cut -d= -f2)
        if [[ -n "$proxy_from_env" ]]; then
            echo "$proxy_from_env"
            return 0
        fi
    fi
    
    # Check if Traefik is already running
    if docker ps --format "{{.Names}}" 2>/dev/null | grep -q "hestia-traefik"; then
        echo "traefik"
        return 0
    fi
    
    # Check if Nginx is already running
    if docker ps --format "{{.Names}}" 2>/dev/null | grep -q "hestia-nginx"; then
        echo "nginx"
        return 0
    fi
    
    # Default to nginx
    echo "nginx"
}

# Install Traefik as reverse proxy
install_traefik() {
    local step_name="install_traefik"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would install Traefik reverse proxy"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Installing Traefik reverse proxy..."
    
    # Create Traefik configuration directories
    mkdir -p "$HESTIA_TARGET/config/traefik"
    mkdir -p "$HESTIA_TARGET/data/traefik/letsencrypt"
    mkdir -p "$HESTIA_TARGET/logs/traefik"
    
    # Set permissions for Let's Encrypt
    chmod 600 "$HESTIA_TARGET/data/traefik/letsencrypt" 2>/dev/null || true
    
    # Copy Traefik static configuration
    if [[ -f "$HESTIA_TARGET/install/templates/traefik.yml" ]]; then
        cp "$HESTIA_TARGET/install/templates/traefik.yml" "$HESTIA_TARGET/config/traefik/traefik.yml"
    else
        # Create from embedded template
        create_traefik_static_config
    fi
    
    # Copy Traefik dynamic configuration
    if [[ -f "$HESTIA_TARGET/install/templates/traefik-dynamic.yml" ]]; then
        cp "$HESTIA_TARGET/install/templates/traefik-dynamic.yml" "$HESTIA_TARGET/config/traefik/dynamic.yml"
    else
        # Create from embedded template
        create_traefik_dynamic_config
    fi
    
    # Generate self-signed certificates for local development
    mkdir -p "$HESTIA_TARGET/config/traefik/ssl"
    if [[ ! -f "$HESTIA_TARGET/config/traefik/ssl/cert.pem" ]] || [[ ! -f "$HESTIA_TARGET/config/traefik/ssl/key.pem" ]]; then
        log_info "Generating self-signed SSL certificate for Traefik..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$HESTIA_TARGET/config/traefik/ssl/key.pem" \
            -out "$HESTIA_TARGET/config/traefik/ssl/cert.pem" \
            -subj "/C=US/ST=State/L=City/O=Hestia/CN=localhost" \
            2>/dev/null || true
        chmod 600 "$HESTIA_TARGET/config/traefik/ssl/key.pem"
    fi
    
    # Update environment file
    if [[ -f "$HESTIA_TARGET/config/.env" ]]; then
        # Remove old reverse proxy setting if exists
        sed -i '/^HESTIA_REVERSE_PROXY=/d' "$HESTIA_TARGET/config/.env"
        # Add new setting
        echo "HESTIA_REVERSE_PROXY=traefik" >> "$HESTIA_TARGET/config/.env"
        
        # Add ACME email if not exists
        if ! grep -q "^HESTIA_ACME_EMAIL=" "$HESTIA_TARGET/config/.env"; then
            echo "HESTIA_ACME_EMAIL=admin@localhost" >> "$HESTIA_TARGET/config/.env"
        fi
        
        # Add domain if not exists
        if ! grep -q "^HESTIA_DOMAIN=" "$HESTIA_TARGET/config/.env"; then
            echo "HESTIA_DOMAIN=localhost" >> "$HESTIA_TARGET/config/.env"
        fi
    fi
    
    chown -R hestia:hestia "$HESTIA_TARGET/config/traefik"
    chown -R hestia:hestia "$HESTIA_TARGET/data/traefik"
    chown -R hestia:hestia "$HESTIA_TARGET/logs/traefik"
    
    log_success "Traefik configuration created"
    mark_step_completed "$step_name"
}

# Create Traefik static configuration inline
create_traefik_static_config() {
    cat > "$HESTIA_TARGET/config/traefik/traefik.yml" << 'EOF'
global:
  checkNewVersion: false
  sendAnonymousUsage: false

api:
  dashboard: true
  insecure: true

ping:
  entryPoint: "traefik"

log:
  level: INFO
  format: json

accessLog:
  format: json

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"
  traefik:
    address: ":8080"

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@localhost
      storage: /letsencrypt/acme.json
      tlsChallenge: {}

providers:
  docker:
    exposedByDefault: false
    network: hestia-network
  file:
    filename: /etc/traefik/dynamic.yml
EOF
}

# Create Traefik dynamic configuration inline
create_traefik_dynamic_config() {
    cat > "$HESTIA_TARGET/config/traefik/dynamic.yml" << 'EOF'
http:
  middlewares:
    redirect-to-https:
      redirectScheme:
        scheme: https
        permanent: true
    
    security-headers:
      headers:
        frameDeny: true
        sslRedirect: true
        browserXssFilter: true
        contentTypeNosniff: true
        forceSTSHeader: true
        stsIncludeSubdomains: true
        stsSeconds: 31536000
    
    compression:
      compress:
        minResponseBodyBytes: 1024
EOF
}

# Install Nginx as reverse proxy (existing)
install_nginx() {
    local step_name="install_nginx"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would install Nginx reverse proxy"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Installing Nginx reverse proxy..."
    
    # Create Nginx configuration
    mkdir -p "$HESTIA_TARGET/config/nginx"
    
    if [[ -f "$HESTIA_TARGET/install/templates/nginx.conf" ]]; then
        cp "$HESTIA_TARGET/install/templates/nginx.conf" "$HESTIA_TARGET/config/nginx/nginx.conf"
    else
        create_nginx_config
    fi
    
    # Generate self-signed SSL certificate
    mkdir -p "$HESTIA_TARGET/config/nginx/ssl"
    if [[ ! -f "$HESTIA_TARGET/config/nginx/ssl/cert.pem" ]] || [[ ! -f "$HESTIA_TARGET/config/nginx/ssl/key.pem" ]]; then
        log_info "Generating self-signed SSL certificate for Nginx..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$HESTIA_TARGET/config/nginx/ssl/key.pem" \
            -out "$HESTIA_TARGET/config/nginx/ssl/cert.pem" \
            -subj "/C=US/ST=State/L=City/O=Hestia/CN=localhost" \
            2>/dev/null || true
        chmod 600 "$HESTIA_TARGET/config/nginx/ssl/key.pem"
    fi
    
    # Update environment file
    if [[ -f "$HESTIA_TARGET/config/.env" ]]; then
        sed -i '/^HESTIA_REVERSE_PROXY=/d' "$HESTIA_TARGET/config/.env"
        echo "HESTIA_REVERSE_PROXY=nginx" >> "$HESTIA_TARGET/config/.env"
    fi
    
    chown -R hestia:hestia "$HESTIA_TARGET/config/nginx"
    
    log_success "Nginx configuration created"
    mark_step_completed "$step_name"
}

# Configure reverse proxy based on selection
configure_reverse_proxy() {
    local step_name="configure_reverse_proxy"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    # Detect or use configured proxy
    local proxy_type
    proxy_type=$(detect_reverse_proxy)
    
    log_info "Configuring reverse proxy: $proxy_type"
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would configure $proxy_type reverse proxy"
        mark_step_completed "$step_name"
        return 0
    fi
    
    case "$proxy_type" in
        traefik)
            install_traefik
            ;;
        nginx)
            install_nginx
            ;;
        *)
            log_warn "Unknown proxy type: $proxy_type, defaulting to Nginx"
            install_nginx
            ;;
    esac
    
    mark_step_completed "$step_name"
}

# Create Docker Compose configuration based on proxy type
create_docker_compose_for_proxy() {
    local proxy_type="${1:-nginx}"
    
    case "$proxy_type" in
        traefik)
            create_traefik_docker_compose
            ;;
        nginx)
            create_docker_compose
            ;;
        *)
            log_warn "Unknown proxy type: $proxy_type, using Nginx"
            create_docker_compose
            ;;
    esac
}

# Create Traefik Docker Compose configuration
create_traefik_docker_compose() {
    local step_name="create_docker_compose"
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would create Traefik Docker Compose configuration"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Creating Traefik Docker Compose configuration..."
    
    # Backup existing if present
    if [[ -f "$HESTIA_TARGET/docker-compose.yml" ]]; then
        if [[ "$HESTIA_SAFE_MODE" == "1" ]]; then
            log_info "Safe mode - preserving existing docker-compose.yml"
            mark_step_completed "$step_name"
            return 0
        fi
        mv "$HESTIA_TARGET/docker-compose.yml" "$HESTIA_TARGET/docker-compose.yml.backup.$(date +%s)"
        log_info "Backed up existing docker-compose.yml"
    fi
    
    # Use template if available
    if [[ -f "$HESTIA_TARGET/install/templates/traefik-docker-compose.yml" ]]; then
        cp "$HESTIA_TARGET/install/templates/traefik-docker-compose.yml" "$HESTIA_TARGET/docker-compose.yml"
    else
        # Create inline
        create_traefik_docker_compose_inline
    fi
    
    chown hestia:hestia "$HESTIA_TARGET/docker-compose.yml"
    
    log_success "Traefik Docker Compose configuration created"
    mark_step_completed "$step_name"
}

# Create Traefik Docker Compose inline
create_traefik_docker_compose_inline() {
    cat > "$HESTIA_TARGET/docker-compose.yml" << 'EOF'
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    container_name: hestia-traefik
    restart: unless-stopped
    command:
      - "--api.dashboard=true"
      - "--api.insecure=true"
      - "--ping=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=hestia-network"
      - "--providers.file.filename=/etc/traefik/dynamic.yml"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.traefik.address=:8080"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.email=${HESTIA_ACME_EMAIL:-admin@localhost}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--log.level=INFO"
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ${HESTIA_HOME}/config/traefik/dynamic.yml:/etc/traefik/dynamic.yml:ro
      - ${HESTIA_HOME}/data/traefik/letsencrypt:/letsencrypt
    networks:
      - hestia-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.traefik.rule=Host(`traefik.${HESTIA_DOMAIN:-localhost}`)"
      - "traefik.http.routers.traefik.entrypoints=websecure"
      - "traefik.http.routers.traefik.service=api@internal"
      - "traefik.http.routers.traefik.tls.certresolver=letsencrypt"

  postgres:
    image: ankane/pgvector:latest
    container_name: hestia-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-hestia}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-hestia}
    volumes:
      - ${DATA_DIR}/postgres:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    networks:
      - hestia-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    labels:
      - "traefik.enable=false"

  typesense:
    image: typesense/typesense:0.25.1
    container_name: hestia-typesense
    restart: unless-stopped
    environment:
      TYPESENSE_API_KEY: ${TYPESENSE_API_KEY:-typesense-api-key}
      TYPESENSE_DATA_DIR: /data
    volumes:
      - ${DATA_DIR}/typesense:/data
    networks:
      - hestia-network
    labels:
      - "traefik.enable=false"

  redis:
    image: redis:7-alpine
    container_name: hestia-redis
    restart: unless-stopped
    volumes:
      - ${DATA_DIR}/redis:/data
    networks:
      - hestia-network
    labels:
      - "traefik.enable=false"

  synap-backend:
    image: ghcr.io/synap/synap-backend:latest
    container_name: hestia-synap-backend
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: redis://redis:6379
      TYPESENSE_API_KEY: ${TYPESENSE_API_KEY:-typesense-api-key}
      TYPESENSE_NODES: http://typesense:8108
      JWT_SECRET: ${JWT_SECRET}
      API_KEY: ${API_KEY}
      PORT: 4000
      NODE_ENV: production
    ports:
      - "4000:4000"
    volumes:
      - ${DATA_DIR}/uploads:/app/uploads
    networks:
      - hestia-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.synap-backend.rule=Host(`${HESTIA_DOMAIN:-localhost}`) && PathPrefix(`/api`)"
      - "traefik.http.routers.synap-backend.entrypoints=websecure"
      - "traefik.http.routers.synap-backend.tls.certresolver=letsencrypt"
      - "traefik.http.services.synap-backend.loadbalancer.server.port=4000"

  openclaw:
    image: ghcr.io/synap/openclaw:latest
    container_name: hestia-openclaw
    restart: unless-stopped
    depends_on:
      - synap-backend
    environment:
      SYNAP_BACKEND_URL: http://synap-backend:4000
      SYNAP_API_KEY: ${API_KEY}
      REDIS_URL: redis://redis:6379
      PORT: 8080
      NODE_ENV: production
    ports:
      - "8080:8080"
    volumes:
      - ${DATA_DIR}/openclaw:/app/data
    networks:
      - hestia-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.openclaw.rule=Host(`${HESTIA_DOMAIN:-localhost}`) && PathPrefix(`/gateway`)"
      - "traefik.http.routers.openclaw.entrypoints=websecure"
      - "traefik.http.routers.openclaw.tls.certresolver=letsencrypt"
      - "traefik.http.services.openclaw.loadbalancer.server.port=8080"

networks:
  hestia-network:
    driver: bridge
EOF
}

# ============================================================================
# PANGOLIN TUNNEL (Optional)
# ============================================================================

# Install Pangolin tunnel for secure remote access
# This is optional and disabled by default
install_pangolin() {
    local step_name="install_pangolin"
    
    # Check if Pangolin is requested (via env var or prompt)
    if [[ "${HESTIA_ENABLE_TUNNEL:-}" != "true" ]] && [[ "${HESTIA_TUNNEL_MODE:-}" == "" ]]; then
        # Not requested, skip silently (this is optional)
        return 0
    fi
    
    if ! should_run_step "$step_name"; then
        return 0
    fi
    
    if [[ "$DRY_RUN_MODE" == true ]]; then
        log_dryrun "Would install Pangolin tunnel (${HESTIA_TUNNEL_MODE:-client} mode)"
        mark_step_completed "$step_name"
        return 0
    fi
    
    log_info "Installing Pangolin tunnel..."
    
    # Ensure Pangolin directories exist
    mkdir -p "$HESTIA_TARGET/config/pangolin"
    mkdir -p "$DATA_DIR/pangolin/server"
    mkdir -p "$DATA_DIR/pangolin/client"
    mkdir -p "$DATA_DIR/pangolin/certs"
    mkdir -p "$LOGS_DIR/pangolin"
    
    # Copy Pangolin Docker Compose template
    if [[ -f "$HESTIA_TARGET/install/templates/pangolin-docker-compose.yml" ]]; then
        cp "$HESTIA_TARGET/install/templates/pangolin-docker-compose.yml" "$HESTIA_TARGET/docker-compose.pangolin.yml"
    else
        log_warn "Pangolin template not found, creating minimal config"
        create_pangolin_compose_inline
    fi
    
    # Generate WireGuard keys if not present
    if [[ -z "${PANGOLIN_WG_PRIVATE_KEY:-}" ]] || [[ -z "${PANGOLIN_WG_PUBLIC_KEY:-}" ]]; then
        log_info "Generating WireGuard keys..."
        
        # Generate using wg if available
        if command -v wg &> /dev/null; then
            PANGOLIN_WG_PRIVATE_KEY=$(wg genkey)
            PANGOLIN_WG_PUBLIC_KEY=$(echo "$PANGOLIN_WG_PRIVATE_KEY" | wg pubkey)
        else
            # Fallback: generate using OpenSSL
            PANGOLIN_WG_PRIVATE_KEY=$(openssl rand -base64 44 | tr -d '\n')
            PANGOLIN_WG_PUBLIC_KEY=$(openssl rand -base64 44 | tr -d '\n')
        fi
        
        # Save to .env
        cat >> "$HESTIA_TARGET/config/.env" << EOF

# Pangolin WireGuard Keys
PANGOLIN_WG_PRIVATE_KEY=$PANGOLIN_WG_PRIVATE_KEY
PANGOLIN_WG_PUBLIC_KEY=$PANGOLIN_WG_PUBLIC_KEY
EOF
    fi
    
    # Set tunnel mode
    local tunnel_mode="${HESTIA_TUNNEL_MODE:-client}"
    
    # Add tunnel configuration
    cat >> "$HESTIA_TARGET/config/.env" << EOF

# Pangolin Tunnel Configuration
TUNNEL_MODE=$tunnel_mode
PANGOLIN_DOMAIN=${PANGOLIN_DOMAIN:-tunnel.${HESTIA_DOMAIN:-localhost}}
PANGOLIN_BASE_URL=${PANGOLIN_BASE_URL:-https://tunnel.${HESTIA_DOMAIN:-localhost}}
PANGOLIN_SERVER_PORT=${PANGOLIN_SERVER_PORT:-3000}
PANGOLIN_WG_PORT=${PANGOLIN_WG_PORT:-51820}
PANGOLIN_API_KEY=${PANGOLIN_API_KEY:-$(openssl rand -hex 32)}
EOF
    
    # If client mode, prompt for server details
    if [[ "$tunnel_mode" == "client" ]] && [[ -z "${PANGOLIN_SERVER_URL:-}" ]]; then
        log_warn "Client mode selected but no server URL configured"
        log_info "Run 'hestia tunnel:enable --mode client --server <url>' after installation"
    fi
    
    chown -R hestia:hestia "$HESTIA_TARGET/config/pangolin"
    chown -R hestia:hestia "$DATA_DIR/pangolin"
    
    log_success "Pangolin tunnel installed (${tunnel_mode} mode)"
    mark_step_completed "$step_name"
}

# Create minimal Pangolin compose inline
create_pangolin_compose_inline() {
    cat > "$HESTIA_TARGET/docker-compose.pangolin.yml" << 'EOF'
version: '3.8'
services:
  pangolin-server:
    image: fosrl/pangolin:latest
    container_name: hestia-pangolin-server
    restart: unless-stopped
    profiles: [pangolin-server]
    environment:
      PANGOLIN_MODE: server
      PANGOLIN_SERVER_PORT: 3000
      PANGOLIN_WG_PORT: 51820
      PANGOLIN_WG_PRIVATE_KEY: ${PANGOLIN_WG_PRIVATE_KEY}
      PANGOLIN_WG_PUBLIC_KEY: ${PANGOLIN_WG_PUBLIC_KEY}
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      API_KEY: ${PANGOLIN_API_KEY}
    ports:
      - "${PANGOLIN_SERVER_PORT:-3000}:3000"
      - "${PANGOLIN_WG_PORT:-51820}:51820/udp"
    volumes:
      - ${DATA_DIR}/pangolin/server:/app/data
      - ${LOGS_DIR}/pangolin:/app/logs
    networks:
      - hestia-network

  pangolin-client:
    image: fosrl/pangolin:latest
    container_name: hestia-pangolin-client
    restart: unless-stopped
    profiles: [pangolin-client]
    environment:
      PANGOLIN_MODE: client
      PANGOLIN_SERVER_URL: ${PANGOLIN_SERVER_URL}
      PANGOLIN_CLIENT_TOKEN: ${PANGOLIN_CLIENT_TOKEN}
      PANGOLIN_WG_PRIVATE_KEY: ${PANGOLIN_WG_PRIVATE_KEY}
      PANGOLIN_WG_PUBLIC_KEY: ${PANGOLIN_WG_PUBLIC_KEY}
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
      - net.ipv4.ip_forward=1
    volumes:
      - ${DATA_DIR}/pangolin/client:/app/data
      - ${LOGS_DIR}/pangolin:/app/logs
    networks:
      - hestia-network

networks:
  hestia-network:
    external: true
EOF
}

# Prompt for tunnel setup during first-fire (can be called from first-fire.sh)
prompt_tunnel_setup() {
    # Only ask if interactive and not already configured
    if [[ "${HESTIA_ENABLE_TUNNEL:-}" == "" ]] && [[ -t 0 ]]; then
        echo ""
        echo "═══════════════════════════════════════════════════"
        echo "  Optional: Remote Tunnel Access (Pangolin)"
        echo "═══════════════════════════════════════════════════"
        echo ""
        echo "Pangolin provides secure remote access to your Hestia node"
        echo "from anywhere, even behind CGNAT. It's a self-hosted"
        echo "alternative to Cloudflare Tunnel using WireGuard."
        echo ""
        echo "Options:"
        echo "  1) Skip (default) - No remote access"
        echo "  2) Server - Run on a VPS with public IP (relay)"
        echo "  3) Client - Connect home server to a Pangolin server"
        echo ""
        read -p "Enable remote tunnel? [1/2/3] (1): " tunnel_choice
        
        case "$tunnel_choice" in
            2)
                export HESTIA_ENABLE_TUNNEL=true
                export HESTIA_TUNNEL_MODE=server
                echo "Selected: Server mode (for VPS with public IP)"
                ;;
            3)
                export HESTIA_ENABLE_TUNNEL=true
                export HESTIA_TUNNEL_MODE=client
                echo "Selected: Client mode (connects to server)"
                ;;
            *)
                echo "Skipping tunnel setup (optional)"
                return 0
                ;;
        esac
        
        return 0
    fi
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    init_state
    
    log_info "═══════════════════════════════════════"
    log_info "Phase 2: Core + Gateway"
    log_info "═══════════════════════════════════════"
    
    # Show progress at start
    show_progress
    
    # Detect reverse proxy type
    local proxy_type
    proxy_type=$(detect_reverse_proxy)
    log_info "Using reverse proxy: $proxy_type"
    
    # Run all steps
    create_env_files
    configure_reverse_proxy
    create_docker_compose_for_proxy "$proxy_type"
    create_init_scripts
    
    # Optional: Install Pangolin tunnel (prompt if interactive)
    prompt_tunnel_setup
    install_pangolin
    
    start_core_services
    
    # Show final progress
    show_progress
    
    log_success "═══════════════════════════════════════"
    log_success "Phase 2 Complete!"
    log_success "═══════════════════════════════════════"
    
    if [[ "$proxy_type" == "traefik" ]]; then
        log_info "Services are running at:"
        log_info "  - Synap Backend: http://localhost:4000"
        log_info "  - OpenClaw Gateway: http://localhost:8080"
        log_info "  - Traefik Dashboard: http://localhost:8080"
        log_info "  - API via Traefik: https://localhost"
        log_info ""
        log_info "Traefik features:"
        log_info "  - Dynamic container discovery via Docker labels"
        log_info "  - Automatic HTTPS with Let's Encrypt"
        log_info "  - Dashboard on port 8080"
        log_info "  - Zero-downtime deployments"
    else
        log_info "Services are running at:"
        log_info "  - Synap Backend: http://localhost:4000"
        log_info "  - OpenClaw Gateway: http://localhost:8080"
        log_info "  - API via Nginx: https://localhost"
    fi
    
    log_info ""
    log_info "To re-run: sudo ./install.sh phase2 --force"
    log_info "To switch proxy: hestia proxy switch <nginx|traefik>"
}

main "$@"
