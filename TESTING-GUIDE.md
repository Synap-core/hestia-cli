# Hestia Testing Guide

Complete testing guide for Hestia - Sovereign AI Infrastructure. Use this guide to validate your installation before production deployment.

## Table of Contents

1. [Pre-Flight Testing](#1-pre-flight-testing)
2. [Installation Testing](#2-installation-testing)
3. [Health Monitoring](#3-health-monitoring)
4. [Automated Testing](#4-automated-testing)
5. [Manual Testing Checklist](#5-manual-testing-checklist)
6. [Performance Testing](#6-performance-testing)
7. [Security Testing](#7-security-testing)
8. [Production Readiness](#8-production-readiness)
9. [Debugging Guide](#9-debugging-guide)

---

## 1. Pre-Flight Testing

### 1.1 Running Validation

Before installing Hestia, run the comprehensive validation to check system readiness:

```bash
# Run all validations
hestia validate

# Run with auto-fix for common issues
hestia validate --fix

# Run specific category validation
hestia validate:system
hestia validate:dependencies
hestia validate:config
hestia validate:services
hestia validate:integration

# Output results as JSON for automation
hestia validate --json

# Save report to file
hestia validate --output validation-report.md
```

### 1.2 What to Check Before Installing

**System Requirements:**

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Node.js | 18.x | 20.x |
| RAM | 4GB | 8GB+ |
| Disk | 50GB | 100GB+ |
| CPU | 2 cores | 4 cores+ |

**Supported Platforms:**
- ✅ Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- ✅ macOS (12.0+)
- ❌ Windows (use WSL2)

### 1.3 Interpreting Validation Results

**Example Output:**

```
╔═══════════════════════════════════════════════════════════════╗
║           HESTIA PRODUCTION VALIDATION                          ║
╚═══════════════════════════════════════════════════════════════╝

Validating: system
✓ NODE-VERSION Node.js version: v20.10.0
✓ PLATFORM Platform: linux
✓ ARCHITECTURE Architecture: x64
✓ PERMISSIONS Config directory: writable

Validating: dependency
✓ DOCKER Docker version 24.0.7, build afdd53b
✓ DOCKER-COMPOSE Docker Compose V2: v2.23.0
✓ GIT git version 2.43.0
✓ NETWORK All endpoints reachable
⚠ PORTS Port 11434 is in use - Ollama (optional)

Summary
Total checks: 15
Passed: 14
Failed: 0
Warnings: 1
Auto-fixable: 0
```

**Result Symbols:**
- ✓ = Passed
- ⚠ = Warning (non-critical)
- ✗ = Failed (critical)

### 1.4 Fixing Common Issues

**Issue: Docker not installed**
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# Or use official script
curl -fsSL https://get.docker.com | sh
```

**Issue: Ports in use**
```bash
# Find process using port
sudo lsof -i :3000

# Kill process
sudo kill -9 <PID>

# Or change Hestia ports in config
hestia config set services.frontend.port 3001
```

**Issue: Permission denied**
```bash
# Fix ownership
sudo chown -R $(whoami) ~/.hestia
sudo chown -R $(whoami) /opt/hestia

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. Installation Testing

### 2.1 Testing Each Phase Individually

Hestia installation has 3 phases. Test each phase separately:

**Phase 1: Foundation (OS, Docker, Firewall)**
```bash
sudo bash packages/install/src/install.sh phase1
```

**Expected outputs:**
- System packages updated
- Docker installed and running
- UFW firewall configured
- SSH hardened
- `hestia` user created
- fail2ban configured

**Verification:**
```bash
# Check Docker
docker --version
docker info

# Check firewall
sudo ufw status verbose

# Check fail2ban
sudo systemctl status fail2ban
```

**Phase 2: Core (Synap Backend, OpenClaw)**
```bash
sudo bash packages/install/src/install.sh phase2
```

**Verification:**
```bash
# Check backend health
curl http://localhost:4000/health

# Check OpenClaw
openclaw --version
```

**Phase 3: Builder (OpenClaude, A2A Bridge)**
```bash
sudo bash packages/install/src/install.sh phase3
```

### 2.2 Verifying Phase Completion

**Check phase completion markers:**
```bash
# Phase 1 markers
ls -la /opt/hestia/
cat /etc/systemd/system/hestia.service
id hestia

# Phase 2 markers
curl -s http://localhost:4000/health | jq
ls -la /opt/hestia/packages/

# Phase 3 markers
ls -la ~/.openclaude-profile.json
ls -la ~/.openclaw/
```

### 2.3 Checking Installation Logs

```bash
# View installation logs
cat /opt/hestia/logs/install.log
cat /var/log/hestia/*.log

# Live log monitoring
tail -f /var/log/hestia/install.log

# Docker compose logs
cd /opt/hestia && docker-compose logs -f
```

### 2.4 Troubleshooting Failed Phases

**Phase 1 fails (Docker issues):**
```bash
# Restart Docker
sudo systemctl restart docker

# Check Docker logs
sudo journalctl -u docker.service

# Re-run phase 1
sudo bash packages/install/src/phases/phase1.sh
```

**Phase 2 fails (Backend not starting):**
```bash
# Check port conflicts
sudo netstat -tlnp | grep 4000

# Check database
sudo docker ps | grep postgres
sudo docker logs postgres

# Reset and retry
hestia recovery:repair --database
```

**Phase 3 fails (OpenClaude/Ollama issues):**
```bash
# Check Ollama installation
which ollama
ollama --version

# Check available models
ollama list

# Pull required model
ollama pull llama3.1:8b
```

---

## 3. Health Monitoring

### 3.1 Running Health Checks

```bash
# Full health check
hestia health

# Check specific category
hestia health:services
hestia health:resources
hestia health:network

# Continuous monitoring
hestia health --watch

# Watch with auto-restart
hestia health:watch --auto-restart --interval 60

# Generate report
hestia health:report --format md --output health-report.md
```

### 3.2 Understanding Health Scores

**Health Score Formula:**
- Healthy: 1 point
- Degraded: 0.5 points
- Unhealthy: 0 points
- Score = (points / total) × 100%

**Score Interpretation:**

| Score | Status | Action Required |
|-------|--------|-----------------|
| 95-100% | ✅ Excellent | None |
| 80-94% | ⚠️ Good | Monitor warnings |
| 60-79% | ⚠️ Degraded | Address issues |
| <60% | 🔴 Critical | Immediate action |

**Example Output:**

```
╔═══════════════════════════════════════════════════════════════╗
║           SYSTEM HEALTH CHECK                                   ║
╚═══════════════════════════════════════════════════════════════╝

Health Score: 85%
Status: DEGRADED
[████████████████████░░░░░░░░░░░░░░░░░░]

Last Check: 4/12/2026, 10:30:00 AM

Summary: 20 healthy, 3 degraded, 1 unhealthy

Services
  ✓ Synap Backend     healthy   23ms
  ✓ PostgreSQL        healthy   12ms
  ✓ Redis             healthy   8ms
  ✓ Typesense         healthy   15ms
  ⚠ OpenClaw          degraded  Process running, API not responding
  ⚠ OpenClaude        degraded  gRPC port not accessible
  ✗ A2A Bridge        unhealthy Bridge failed to initialize

Resources
  ✓ Disk Space        healthy   75% free
  ✓ Memory            healthy   60% free
  ⚠ CPU               degraded  Load at 85%
  ✓ Docker Storage    healthy   12GB used

Network
  ✓ Internet          healthy   3/3 hosts reachable
  ✓ DNS               healthy   3/3 domains resolved
  ✓ Firewall          healthy   Active with 8 rules
  ✓ Port Bindings     healthy   6/8 ports accessible

Integrations
  ✓ State Sync        healthy   0 pending, 0 conflicts
  ⚠ Agent Connectivity degraded  2/3 agents online
  ✓ Database          healthy   Connected
  ✓ Backup Status     healthy   Last backup 2h ago

Alerts
  ✗ service.a2aBridge
  ⚠ service.openClaw
  ⚠ service.openClaude
  ⚠ resource.cpu
  ⚠ integration.agentConnectivity
```

### 3.3 Setting Up Continuous Monitoring

**Option 1: CLI Watch Mode**
```bash
# Terminal dashboard
hestia health:watch --interval 30
```

**Option 2: systemd Service**
```bash
# Create monitoring service
sudo tee /etc/systemd/system/hestia-health.service << 'EOF'
[Unit]
Description=Hestia Health Monitor
After=hestia.service

[Service]
Type=simple
User=hestia
ExecStart=/usr/local/bin/hestia health:watch --interval 60
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable hestia-health
sudo systemctl start hestia-health
```

**Option 3: Cron Job**
```bash
# Add to crontab
crontab -e

# Check health every 5 minutes and alert if degraded
*/5 * * * * /usr/local/bin/hestia health --json | jq -e '.overallStatus == "healthy"' || echo "Hestia health check failed" | mail -s "Hestia Alert" admin@example.com
```

### 3.4 Interpreting Degraded/Unhealthy States

**Service Degraded:**
- Process running but not responding
- High latency (>1000ms)
- Partial functionality

**Service Unhealthy:**
- Process not running
- Connection refused
- Critical error

**Resource Degraded:**
- CPU > 80%
- Memory < 20% free
- Disk < 10% free

**Automatic Actions:**
```bash
# Enable auto-restart for failed services
hestia health:watch --auto-restart

# Set thresholds
hestia config set health.diskThreshold 15
hestia config set health.memoryThreshold 25
hestia config set health.cpuThreshold 75
```

---

## 4. Automated Testing

### 4.1 Running Test Suite

```bash
# Run all tests
hestia test

# Run specific test category
hestia test:unit          # Unit tests only
hestia test:integration   # Integration tests only
hestia test:e2e          # End-to-end tests only
hestia test:smoke        # Quick smoke tests

# Run with options
hestia test --verbose     # Detailed output
hestia test --parallel    # Parallel execution
hestia test:unit --test testConfig  # Single test

# Watch mode for development
hestia test:watch

# CI mode (JSON output)
hestia test:ci
```

### 4.2 Test Categories

**Unit Tests** (~6 tests)
- testConfig - Configuration loading/saving/validation
- testStateManager - State management operations
- testApiClient - API client with mocking
- testPackageService - Package operations
- testA2ABridge - A2A bridge functionality
- testHealthCheck - Health check logic

**Integration Tests** (~5 tests)
- testSynapBackendConnection - Backend connectivity
- testOpenClaudeIntegration - OpenClaude integration
- testOpenClawIntegration - OpenClaw integration
- testA2AMessaging - Agent-to-agent messaging
- testStateSync - State synchronization

**End-to-End Tests** (~5 tests)
- testFullInstallation - Complete installation flow
- testServiceLifecycle - Start/stop/restart operations
- testConfigurationFlow - Configuration wizard
- testPackageManagement - Add/remove/update packages
- testAgentWorkflow - Full agent workflow

**Smoke Tests** (~4 tests)
- testCLI - CLI commands work
- testServices - Services start/stop
- testConnectivity - Network connectivity
- testPersistence - Data persistence

### 4.3 Expected Test Output

```
╔═══════════════════════════════════════════════════════════════╗
║           Hestia Test Suite                                     ║
╚═══════════════════════════════════════════════════════════════╝

Total: 20
Passed: 19
Failed: 0
Pass Rate: 95.0%
Duration: 45000ms

Results by Category
  ✓ unit: 6/6 (8500ms)
    ✓ config 120ms
    ✓ state manager 450ms
    ✓ api client 320ms
    ✓ package service 280ms
    ✓ a2a bridge 390ms
    ✓ health check 180ms

  ✓ integration: 5/5 (12000ms)
    ✓ synap backend connection 2400ms
    ✓ openclaude integration 3100ms
    ✓ openclaw integration 1800ms
    ✓ a2a messaging 2600ms
    ✓ state sync 2100ms

  ✓ e2e: 5/5 (18000ms)
    ✓ full installation 4500ms
    ✓ service lifecycle 3200ms
    ✓ configuration flow 2800ms
    ✓ package management 4100ms
    ✓ agent workflow 3400ms

  ✓ smoke: 4/4 (6500ms)
    ✓ cli 800ms
    ✓ services 2100ms
    ✓ connectivity 1800ms
    ✓ persistence 1800ms

Slow Tests (>1000ms)
  ⚠ testFullInstallation: 4500ms
  ⚠ testOpenClaudeIntegration: 3100ms

All tests passed! ✓
```

### 4.4 CI/CD Integration

**GitHub Actions Example:**

```yaml
name: Hestia Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install Hestia CLI
        run: npm install -g @hestia/cli
      
      - name: Validate Installation
        run: hestia validate --json
      
      - name: Run Tests
        run: hestia test:ci --category unit
      
      - name: Health Check
        run: hestia health --json
```

**GitLab CI Example:**

```yaml
stages:
  - validate
  - test
  - health

validate:
  stage: validate
  script:
    - npm install -g @hestia/cli
    - hestia validate --json > validation.json
  artifacts:
    reports:
      junit: validation.json

test:
  stage: test
  script:
    - hestia test:ci --category unit
  artifacts:
    reports:
      junit: test-results.json

health_check:
  stage: health
  script:
    - hestia health --json > health.json
  only:
    - main
```

### 4.5 Smoke Test Commands

Quick validation that everything is working:

```bash
#!/bin/bash
# smoke-test.sh

set -e

echo "=== Hestia Smoke Tests ==="

# Test 1: CLI works
hestia --version || exit 1
echo "✓ CLI available"

# Test 2: Config exists
hestia config get hearth.name || exit 1
echo "✓ Configuration accessible"

# Test 3: Services respond
curl -s http://localhost:4000/health > /dev/null || exit 1
echo "✓ Backend healthy"

# Test 4: Database accessible
docker exec postgres pg_isready -U postgres > /dev/null || exit 1
echo "✓ Database ready"

# Test 5: Health check passes
hestia health --json | jq -e '.overallStatus == "healthy"' || exit 1
echo "✓ System healthy"

echo "=== All smoke tests passed ==="
```

---

## 5. Manual Testing Checklist

### 5.1 CLI Commands Work

```bash
# Basic commands
hestia --help
hestia --version

# Status commands
hestia status
hestia config

# Service commands
hestia ignite    # Start all
hestia status    # Check status
hestia extinguish # Stop all

# Package management
hestia package list
hestia package info <name>
hestia package logs <name>
hestia package update
```

### 5.2 Services Start/Stop

**Start Services:**
```bash
hestia ignite
```

**Verify Services:**
```bash
# Check all containers running
docker ps

# Check specific services
curl http://localhost:3000/health    # Frontend
curl http://localhost:4000/health    # Backend
curl http://localhost:3001/status    # Intelligence Hub
curl http://localhost:3002/status  # OpenClaw
```

**Stop Services:**
```bash
hestia extinguish
```

**Restart Individual Service:**
```bash
hestia package restart <package-name>
```

### 5.3 Configuration Syncs

```bash
# View config
hestia config

# Get specific value
hestia config get hearth.name
hestia config get intelligence.provider

# Set value
hestia config set hearth.name "Production Hearth"
hestia config set intelligence.model "llama3.1:8b"

# Verify sync
hestia config get hearth.name
```

### 5.4 Agents Communicate

```bash
# Check agent status
hestia agents list
hestia agents status

# Send test message
hestia agents send --from openclaude --to openclaw --message "Test message"

# Check A2A bridge stats
hestia agents stats
```

### 5.5 Backup/Restore Works

```bash
# Create backup
hestia recovery:backup --name "pre-production-backup"

# List backups
hestia recovery:list

# Restore from backup
hestia recovery:restore --name "pre-production-backup"

# Create rollback point before changes
hestia recovery:rollback --create-point "before-update"
```

### 5.6 Recovery Procedures

**Diagnose Issues:**
```bash
hestia recovery:diagnose --verbose
```

**Repair System:**
```bash
# Run all repairs
hestia recovery:repair --all

# Or specific repairs
hestia recovery:repair --permissions
hestia recovery:repair --dependencies
hestia recovery:repair --network
hestia recovery:repair --docker
hestia recovery:repair --database
hestia recovery:repair --sync
```

**Enter Safe Mode:**
```bash
hestia recovery:safe-mode
```

**Exit Safe Mode:**
```bash
hestia recovery:safe-mode  # Toggle off
```

**Auto-Recovery:**
```bash
hestia recovery:auto --dry-run  # Preview fixes
hestia recovery:auto            # Apply fixes
```

---

## 6. Performance Testing

### 6.1 Load Testing

**Simulate Load:**
```bash
# Install hey (HTTP load generator)
go install github.com/rakyll/hey@latest

# Test backend API
hey -n 1000 -c 10 http://localhost:4000/health

# Test frontend
hey -n 1000 -c 10 http://localhost:3000
```

**Expected Results:**

| Endpoint | Requests | Concurrency | Avg Response | P95 |
|----------|----------|-------------|--------------|-----|
| /health | 1000 | 10 | <50ms | <100ms |
| Frontend | 1000 | 10 | <200ms | <500ms |

### 6.2 Resource Usage Monitoring

```bash
# Real-time resource monitoring
watch -n 1 'docker stats --no-stream'

# CPU and memory usage
htop

# Disk usage
df -h /opt/hestia
du -sh /opt/hestia/*

# Docker storage
docker system df
```

**Expected Resource Usage:**

| Resource | Idle | Normal Load | High Load |
|----------|------|-------------|-----------|
| CPU | <5% | 10-30% | 50-80% |
| Memory | 2-4GB | 4-6GB | 6-8GB |
| Disk | 20GB | 30-50GB | 50-100GB |

### 6.3 Response Time Testing

```bash
# Create response time test script
cat > test-response-times.sh << 'EOF'
#!/bin/bash

ENDPOINTS=(
  "http://localhost:3000/health:Frontend"
  "http://localhost:4000/health:Backend"
  "http://localhost:4000/api/hub/health:Hub Protocol"
  "http://localhost:8108/health:Typesense"
)

for endpoint in "${ENDPOINTS[@]}"; do
  IFS=':' read -r url name <<< "$endpoint"
  
  # Warmup
  curl -s "$url" > /dev/null
  
  # Measure
  times=()
  for i in {1..10}; do
    start=$(date +%s%N)
    curl -s "$url" > /dev/null
    end=$(date +%s%N)
    time=$(( (end - start) / 1000000 ))
    times+=($time)
  done
  
  # Calculate average
  sum=0
  for t in "${times[@]}"; do
    sum=$((sum + t))
  done
  avg=$((sum / ${#times[@]}))
  
  echo "$name: ${avg}ms"
done
EOF

chmod +x test-response-times.sh
./test-response-times.sh
```

**Expected Response Times:**

| Service | Target | Warning | Critical |
|---------|--------|---------|----------|
| Frontend | <100ms | 100-300ms | >300ms |
| Backend API | <50ms | 50-200ms | >200ms |
| Database | <20ms | 20-100ms | >100ms |
| Search | <100ms | 100-500ms | >500ms |

### 6.4 Scalability Limits

**Test Concurrent Connections:**
```bash
# Test with increasing concurrency
for c in 10 50 100 200; do
  echo "Testing with $c concurrent connections..."
  hey -n 1000 -c $c http://localhost:4000/health 2>&1 | grep "Requests/sec"
done
```

**Database Connection Limits:**
```bash
# Check PostgreSQL connections
docker exec postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# Check max connections
docker exec postgres psql -U postgres -c "SHOW max_connections;"
```

---

## 7. Security Testing

### 7.1 Firewall Rules

```bash
# Check UFW status
sudo ufw status verbose

# Verify expected rules
cat << 'EOF' | bash
#!/bin/bash
REQUIRED_PORTS=(22 80 443 3000 4000 5173)
for port in "${REQUIRED_PORTS[@]}"; do
  if sudo ufw status | grep -q "$port/tcp"; then
    echo "✓ Port $port allowed"
  else
    echo "✗ Port $port NOT found"
  fi
done
EOF
```

**Expected UFW Rules:**

```
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     LIMIT IN    Anywhere                   # SSH
80/tcp                     ALLOW IN    Anywhere                   # HTTP
443/tcp                    ALLOW IN    Anywhere                   # HTTPS
3000/tcp                   ALLOW IN    Anywhere                   # Synap Frontend
4000/tcp                   ALLOW IN    Anywhere                   # Synap Backend
5173/tcp                   ALLOW IN    Anywhere                   # Admin Dashboard
```

### 7.2 API Key Validation

```bash
# Test without API key (should fail for protected endpoints)
curl -s http://localhost:4000/api/hub/entities | jq

# Test with valid API key
curl -s -H "Authorization: Bearer $HESTIA_API_KEY" \
  http://localhost:4000/api/hub/entities | jq

# Test with invalid API key
curl -s -H "Authorization: Bearer invalid_key" \
  http://localhost:4000/api/hub/entities | jq
```

### 7.3 Permission Checks

```bash
# Check file permissions
ls -la ~/.hestia/
ls -la ~/.hestia/credentials

# Verify correct ownership
stat -c "%U:%G %a %n" ~/.hestia/
stat -c "%U:%G %a %n" ~/.hestia/credentials

# Check Docker socket permissions
ls -la /var/run/docker.sock
```

**Expected Permissions:**

| Path | Owner | Permissions |
|------|-------|-------------|
| ~/.hestia/ | user:user | 755 |
| ~/.hestia/credentials | user:user | 600 |
| /opt/hestia/ | hestia:hestia | 755 |

### 7.4 Access Control

```bash
# Test SSH access
ssh -v hestia@<server-ip>

# Check fail2ban status
sudo fail2ban-client status
sudo fail2ban-client status sshd

# Verify SSH config
grep -E "^(PermitRootLogin|PasswordAuthentication|MaxAuthTries)" /etc/ssh/sshd_config
```

**Expected SSH Configuration:**
```
PermitRootLogin no
PasswordAuthentication no  # (if using keys)
MaxAuthTries 3
```

---

## 8. Production Readiness

### 8.1 Production Validation

```bash
# Run strict production validation
hestia validate:production

# Generate production readiness report
hestia validate:production --report

# Save report
hestia validate:production --output production-report.md
```

**What Production Validation Checks:**

1. **No warnings allowed** - All warnings must be resolved
2. **Required services running** - All production services healthy
3. **Security hardening** - Firewall, SSH, fail2ban configured
4. **Backup configured** - At least one backup exists
5. **Monitoring enabled** - Health checks passing
6. **Performance acceptable** - Response times within limits

**Example Production Report:**

```
# Hestia Production Readiness Report

**Date:** 2026-04-12T10:30:00.000Z
**Status:** ✅ PRODUCTION READY
**Duration:** 4500ms

## Summary

| Metric | Count |
|--------|-------|
| Total Checks | 25 |
| Passed | 25 |
| Failed | 0 |
| Warnings | 0 |
| Auto-fixable | 0 |

## Production Blockers

None ✓

## Warnings (Strict Mode)

None ✓

## Recommendations

- ℹ️ Consider enabling automatic backups
- ℹ️ Review log retention policies
- ℹ️ Set up external monitoring

## Detailed Results

### ✅ system
Node.js 20.10.0 ✓
Platform: linux ✓
Architecture: x64 ✓
All permissions correct ✓

### ✅ dependency
Docker running ✓
Docker Compose V2 ✓
Git configured ✓
Network connectivity OK ✓
All ports available ✓

### ✅ hestia
Configuration valid ✓
Directories writable ✓
Synap Backend connected ✓
API key valid ✓

### ✅ openclaude
@gitlawb/openclaude installed ✓
Profile configured ✓
AI provider configured ✓
MCP servers configured ✓

### ✅ openclaw
OpenClaw CLI available ✓
Configuration valid ✓
Skills directory accessible ✓

### ✅ a2a
A2A Bridge initialized ✓
Agent connectivity OK ✓
Memory store working ✓

### ✅ integration
State sync working ✓
Agent messaging OK ✓
End-to-end validation passed ✓

---
*Generated by Hestia Production Validator*
```

### 8.2 Checklist Before Going Live

**Infrastructure:**
- [ ] All 3 installation phases completed
- [ ] Hestia validate:production passes
- [ ] Health score >= 95%
- [ ] All required ports accessible
- [ ] SSL/TLS certificates installed
- [ ] Domain DNS configured

**Security:**
- [ ] Firewall (UFW) active with correct rules
- [ ] SSH hardened (no root login, key auth)
- [ ] fail2ban configured and running
- [ ] API keys generated and secured
- [ ] Credentials file permissions 600
- [ ] Docker daemon secured

**Services:**
- [ ] Synap Frontend responding
- [ ] Synap Backend healthy
- [ ] PostgreSQL accepting connections
- [ ] Redis responsive
- [ ] Typesense operational
- [ ] OpenClaw running (if enabled)
- [ ] OpenClaude running (if enabled)

**Data:**
- [ ] Backup created and verified
- [ ] Backup restoration tested
- [ ] Rollback point created
- [ ] Database migrations applied

**Monitoring:**
- [ ] Health checks passing
- [ ] Log aggregation configured
- [ ] Alerting set up
- [ ] Continuous monitoring enabled

**Documentation:**
- [ ] Runbook created
- [ ] Emergency contacts documented
- [ ] Recovery procedures tested

### 8.3 Monitoring Setup

**Install Monitoring Stack:**
```bash
# Add monitoring package
hestia add monitoring

# Configure alerts
hestia config set alerts.email "admin@example.com"
hestia config set alerts.slack "#alerts"
```

**Configure Health Check Alerts:**
```bash
# Create alert script
cat > /opt/hestia/bin/health-alert.sh << 'EOF'
#!/bin/bash
REPORT=$(hestia health --json)
STATUS=$(echo $REPORT | jq -r '.overallStatus')

if [ "$STATUS" != "healthy" ]; then
  SCORE=$(echo $REPORT | jq -r '.healthScore')
  echo "Hestia health degraded: $STATUS ($SCORE%)" | \
    mail -s "Hestia Alert" admin@example.com
fi
EOF

chmod +x /opt/hestia/bin/health-alert.sh

# Add to crontab
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/hestia/bin/health-alert.sh") | crontab -
```

### 8.4 Backup Verification

**Verify Backup System:**
```bash
# List available backups
hestia recovery:list

# Create fresh backup
hestia recovery:backup --name "pre-production-final"

# Test restore on staging (DANGEROUS on production!)
# hestia recovery:restore --name "pre-production-final" --dry-run

# Verify backup integrity
hestia recovery:diagnose | grep -i backup
```

**Automated Backup Schedule:**
```bash
# Add to crontab for daily backups
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/hestia recovery:backup --auto") | crontab -
```

---

## 9. Debugging Guide

### 9.1 Common Issues

**Issue: "Hestia command not found"**
```bash
# Check if CLI is installed
which hestia
npm list -g @hestia/cli

# Reinstall if needed
npm install -g @hestia/cli

# Or use npx
npx @hestia/cli status
```

**Issue: "Configuration not found"**
```bash
# Initialize configuration
hestia init

# Check config location
hestia config
ls -la ~/.hestia/
```

**Issue: "Permission denied"**
```bash
# Fix ownership
sudo chown -R $(whoami):$(whoami) ~/.hestia
sudo chown -R $(whoami):$(whoami) /opt/hestia

# Fix permissions
chmod 755 ~/.hestia
chmod 600 ~/.hestia/credentials
```

**Issue: "Port already in use"**
```bash
# Find process using port
sudo lsof -i :3000
sudo lsof -i :4000

# Kill process
sudo kill -9 <PID>

# Or change port in config
hestia config set services.frontend.port 3001
```

**Issue: "Database connection failed"**
```bash
# Check PostgreSQL container
docker ps | grep postgres
docker logs postgres

# Restart database
docker restart postgres

# Check connection
docker exec postgres pg_isready -U postgres
```

**Issue: "Services won't start"**
```bash
# Check logs
hestia package logs <name>
docker-compose logs

# Run diagnostics
hestia recovery:diagnose --verbose

# Try repair
hestia recovery:repair --all
```

**Issue: "High memory/CPU usage"**
```bash
# Check resource usage
docker stats
htop

# Restart services
hestia extinguish
hestia ignite

# Clear Docker cache
docker system prune -a
```

### 9.2 Log Locations

**Hestia Logs:**
| Location | Contents |
|----------|----------|
| `/var/log/hestia/install.log` | Installation logs |
| `/var/log/hestia/hestia.log` | Main Hestia logs |
| `/opt/hestia/logs/` | Package logs |
| `~/.hestia/logs/` | User-level logs |
| `docker-compose logs` | Docker container logs |

**System Logs:**
```bash
# View system logs
sudo journalctl -u hestia
sudo journalctl -u docker
sudo journalctl -u fail2ban

# View auth logs
sudo tail -f /var/log/auth.log

# View syslog
sudo tail -f /var/log/syslog
```

**Application Logs:**
```bash
# Backend logs
docker logs synap-backend
docker logs -f synap-backend

# Database logs
docker logs postgres

# Redis logs
docker logs redis

# Typesense logs
docker logs typesense
```

### 9.3 Debug Mode

**Enable Debug Logging:**
```bash
# Set debug environment variable
export HESTIA_DEBUG=1

# Run command with debug
hestia status --verbose

# Or use CLI flag
hestia --debug validate
```

**Debug Commands:**
```bash
# Diagnose specific component
hestia recovery:diagnose --verbose

# Check A2A bridge
hestia agents stats

# Check state sync
hestia state sync --verbose

# API debugging
hestia --debug api call /health
```

**Generate Debug Report:**
```bash
# Full system report
hestia validate --verbose --output debug-report.json

# Include system info
hestia validate:system --verbose

# Health with details
hestia health --json | jq
```

### 9.4 Getting Help

**Before asking for help, collect:**

1. **System information:**
```bash
hestia validate:system --json > system-info.json
```

2. **Health status:**
```bash
hestia health --json > health-status.json
```

3. **Recent logs:**
```bash
tail -n 500 /var/log/hestia/hestia.log > recent-logs.txt
docker-compose logs --tail 500 > docker-logs.txt
```

4. **Configuration (sanitized):**
```bash
hestia config > config.txt
# Remove API keys before sharing!
```

**Support Channels:**
- GitHub Issues: https://github.com/synap/hestia/issues
- Documentation: https://docs.hestia.dev
- Community Discord: https://discord.gg/hestia

**When reporting issues, include:**
- Hestia version: `hestia --version`
- Node.js version: `node --version`
- OS: `uname -a`
- Validation output: `hestia validate --json`
- Relevant logs (sanitized)
- Steps to reproduce

---

## Quick Reference

### Essential Commands

| Command | Purpose |
|---------|---------|
| `hestia validate` | Check system readiness |
| `hestia validate:production` | Production readiness check |
| `hestia health` | System health check |
| `hestia health:watch` | Continuous monitoring |
| `hestia test` | Run test suite |
| `hestia test:smoke` | Quick sanity check |
| `hestia recovery:diagnose` | System diagnosis |
| `hestia recovery:repair` | Repair issues |
| `hestia recovery:backup` | Create backup |
| `hestia recovery:restore` | Restore backup |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success / Healthy |
| 1 | Degraded / Warnings |
| 2 | Unhealthy / Critical |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HESTIA_HOME` | Installation directory |
| `HESTIA_TARGET` | Target directory for installs |
| `HESTIA_CONFIG_DIR` | Configuration directory |
| `HESTIA_DEBUG` | Enable debug logging |
| `HESTIA_API_KEY` | API authentication |
| `HESTIA_SAFE_MODE` | Preserve existing data |
| `HESTIA_UNATTENDED` | Non-interactive mode |

---

## Summary

This guide covers comprehensive testing for Hestia deployment. Key takeaways:

1. **Always run `hestia validate` before installation**
2. **Use `hestia validate:production` before going live**
3. **Set up continuous health monitoring**
4. **Create backups before any major changes**
5. **Test recovery procedures regularly**
6. **Monitor health scores and respond to degradation**

Remember: A well-tested Hestia installation is a reliable foundation for your sovereign AI infrastructure.

---

*Last updated: April 2026*
*Version: Hestia CLI 0.1.0*
