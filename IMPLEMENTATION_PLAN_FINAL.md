# Implementation Plan - FINAL with Corrections

## Corrections Applied

1. Dokploy (not Docploy) - https://dokploy.com/
2. OpenClaude in Builder (not Arms)
3. Builder = OpenCode + OpenClaude + Dokploy

## Phase 1: Foundation (Week 1)

### Packages to Create
- @hestia/dna - Config and state
- @hestia/brain - Synap + Ollama

### Commands
- hestia brain init
- hestia brain init --with-ai

## Phase 2: Entity State (Week 2)

### Commands
- hestia status - Show entity state
- hestia doctor - Diagnose issues

## Phase 3: Arms (Week 3)

### Package
- @hestia/arms - OpenClaw

### Commands
- hestia arms install
- hestia arms start

## Phase 4: Builder (Week 4)

### Package
- @hestia/builder - OpenCode + OpenClaude + Dokploy

### Commands
- hestia builder init
- hestia builder deploy (uses Dokploy)

## Phase 5: Eyes & Legs (Week 5)

### Packages
- @hestia/eyes - RSSHub
- @hestia/legs - Traefik (via Dokploy)

### Commands
- hestia eyes install
- hestia legs setup

## Phase 6: Intelligence (Week 6)

### Commands
- hestia grow - Intelligent growth

## Final Architecture

Organs:
- Brain: Synap + Ollama
- Arms: OpenClaw
- Builder: OpenCode + OpenClaude + Dokploy
- Eyes: RSSHub
- Legs: Traefik (via Dokploy)

Focus Path: AI Entity (Path 2)
