#!/bin/bash

# Script pour organiser le code core en domaines

cd /Users/antoine/Documents/Code/synap/eve-cli/packages/core

echo "Organisation des domaines dans core..."

# 1. USB Domain
echo "Organisation du domaine USB..."
mkdir -p src/domains/usb/lib src/domains/usb/commands
mv src/lib/usb-generator.ts src/domains/usb/lib/
mv src/commands/usb.ts src/domains/usb/commands/

# 2. Install Domain
echo "Organisation du domaine Install..."
mkdir -p src/domains/install/lib src/domains/install/commands
mv src/lib/os-manager.ts src/domains/install/lib/
mv src/lib/hardware-monitor.ts src/domains/install/lib/
mv src/commands/install.ts src/domains/install/commands/
mv src/commands/hardware.ts src/domains/install/commands/
mv src/commands/os.ts src/domains/install/commands/

# 3. Registry Domain
echo "Organisation du domaine Registry..."
mkdir -p src/domains/registry/lib src/domains/registry/commands
mv src/lib/package-service.ts src/domains/registry/lib/
mv src/commands/package.ts src/domains/registry/commands/
mv src/commands/add.ts src/domains/registry/commands/
mv src/commands/remove.ts src/domains/registry/commands/

# 4. Provision Domain
echo "Organisation du domaine Provision..."
mkdir -p src/domains/provision/lib src/domains/provision/commands
mv src/lib/server-provisioner.ts src/domains/provision/lib/
mv src/lib/workspace-setup.ts src/domains/provision/lib/
mv src/commands/provision.ts src/domains/provision/commands/

# 5. Services Domain
echo "Organisation du domaine Services..."
mkdir -p src/domains/services/lib src/domains/services/commands
mv src/lib/service-manager.ts src/domains/services/lib/
mv src/lib/optional-services.ts src/domains/services/lib/
mv src/lib/health-check.ts src/domains/services/lib/
mv src/lib/recovery.ts src/domains/services/lib/
mv src/lib/pangolin-service.ts src/domains/services/lib/
mv src/lib/whodb-service.ts src/domains/services/lib/
mv src/lib/state-manager.ts src/domains/services/lib/
mv src/lib/a2a-bridge.ts src/domains/services/lib/
mv src/commands/services.ts src/domains/services/commands/
mv src/commands/health.ts src/domains/services/commands/
mv src/commands/recovery.ts src/domains/services/commands/
mv src/commands/tunnel.ts src/domains/services/commands/
mv src/commands/db-viewer.ts src/domains/services/commands/

# 6. Shared Domain (utilitaires partagés)
echo "Organisation du domaine Shared..."
mkdir -p src/domains/shared/lib
mv src/lib/api-client.ts src/domains/shared/lib/
mv src/lib/validator.ts src/domains/shared/lib/
mv src/lib/test-suite.ts src/domains/shared/lib/
mv src/lib/eve-definition.ts src/domains/shared/lib/
mv src/lib/task-list.ts src/domains/shared/lib/

# 7. Commandes restantes (core CLI)
echo "Organisation des commandes core..."
mv src/commands/agents.ts src/domains/ai/commands/
mv src/commands/assistant.ts src/domains/ai/commands/
mv src/commands/config.ts src/domains/shared/commands/
mv src/commands/extinguish.ts src/domains/shared/commands/
mv src/commands/ignite.ts src/domains/shared/commands/
mv src/commands/init.ts src/domains/shared/commands/
mv src/commands/status.ts src/domains/shared/commands/
mv src/commands/validate.ts src/domains/shared/commands/
mv src/commands/proxy.ts src/domains/shared/commands/

echo "Organisation terminée!"