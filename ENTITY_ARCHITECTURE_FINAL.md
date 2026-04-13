# Hestia Entity Architecture - FINAL CORRECTED VERSION

## Critical Corrections from User

### Correction 1: It's "Dokploy", not "Docploy"
- URL: https://dokploy.com/
- What: Open-source PaaS for deployment
- Features: Docker deployment, database management, Traefik
- Part of: Builder organ

### Correction 2: OpenClaude is in BUILDER (not Arms)
Builder Organ Components:
1. OpenCode - Website generation
2. OpenClaude - AI assistant for building
3. Dokploy - Deployment platform

Arms Organ:
- OpenClaw - AI coding assistant

---

## Final Entity Architecture

### BRAIN (Core + Local AI)
Components:
- Synap Backend - Core API, identity, memory
- Ollama - Local AI model engine
- PostgreSQL - Data persistence
- Redis - Cache/queue

Purpose: Central intelligence and local AI inference

Install: hestia brain init --with-ai

---

### ARMS (Action/Execution)
Component: OpenClaw

Purpose:
- Execute tasks
- Code generation
- MCP servers
- Shell automation

Connection: Uses Brain's Ollama for AI inference

Install: hestia arms install

---

### BUILDER (Creation + Deployment)
Components:
1. OpenCode - Website generation
2. OpenClaude - AI assistant for building
3. Dokploy - Deployment platform

Purpose:
- Generate websites
- AI-assisted building
- Deploy to production

Flow: OpenCode/OpenClaude generates -> Dokploy deploys -> Legs expose

Install:
  hestia builder init my-project
  hestia builder deploy

---

### EYES (Perception)
Component: RSSHub

Purpose: RSS aggregation, consume external knowledge

Install: hestia eyes install

---

### LEGS (Exposure)
Component: Traefik (via Dokploy)

Purpose: Expose to internet, SSL, domain routing

Install: hestia legs setup

---

## Three Paths - FINAL

### Path 1: Minimal (Infrastructure Only)
hestia brain init
# Synap + PostgreSQL + Redis only

### Path 2: AI Entity (Full Stack) - FOCUS
hestia brain init --with-ai
hestia arms install
hestia builder init my-site
hestia builder deploy
hestia eyes install
hestia legs setup

### Path 3: AI-Only (Just Ollama)
hestia install ai-only

---

## Summary

Final Organ Mapping:
- Brain: Synap + Ollama
- Arms: OpenClaw
- Builder: OpenCode + OpenClaude + Dokploy
- Eyes: RSSHub
- Legs: Traefik (via Dokploy)

Key Distinctions:
1. Ollama = Brain
2. OpenClaw = Arms
3. OpenClaude = Builder
4. Dokploy = Builder (deployment)
5. Dokploy includes Traefik
