#!/bin/bash

# Script pour remplacer les imports de @hestia/types et @hestia/utils par des chemins relatifs

cd /Users/antoine/Documents/Code/synap/hestia-cli/packages/core

# Remplacer @hestia/types par ../lib/types
find src -name "*.ts" -type f -exec sed -i '' 's|from "@hestia/types"|from "../lib/types/index"|g' {} \;

# Remplacer @hestia/utils par ../lib/utils
find src -name "*.ts" -type f -exec sed -i '' 's|from "@hestia/utils"|from "../lib/utils/index"|g' {} \;

echo "Imports remplacés avec succès"