#!/bin/bash

# Script pour remplacer les imports de @eve/types et @eve/utils par des chemins relatifs

cd /Users/antoine/Documents/Code/synap/eve-cli/packages/core

# Remplacer @eve/types par ../lib/types
find src -name "*.ts" -type f -exec sed -i '' 's|from "@eve/types"|from "../lib/types/index"|g' {} \;

# Remplacer @eve/utils par ../lib/utils
find src -name "*.ts" -type f -exec sed -i '' 's|from "@eve/utils"|from "../lib/utils/index"|g' {} \;

echo "Imports remplacés avec succès"