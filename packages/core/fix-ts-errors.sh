#!/bin/bash

echo "Fixing TypeScript unused variable errors..."

# Function to fix a specific file and line
fix_line() {
    local file=$1
    local line=$2
    local var=$3
    local type=$4  # "import", "type", or "var"
    
    echo "Fixing $var in $file:$line ($type)"
    
    # Read the line
    local line_content=$(sed -n "${line}p" "$file")
    
    case $type in
        "import")
            # Remove from import statement
            sed -i '' "${line}s/, ${var}//" "$file"
            sed -i '' "${line}s/${var}, //" "$file"
            sed -i '' "${line}s/${var}//" "$file"
            # If import becomes empty, remove the line
            if [[ "$(sed -n "${line}p" "$file")" =~ import.*\{\} ]]; then
                sed -i '' "${line}d" "$file"
            fi
            ;;
        "type")
            # Comment out type declaration
            sed -i '' "${line}s/^/\/\/ /" "$file"
            ;;
        "var")
            # Prefix with underscore for unused parameters
            sed -i '' "${line}s/\b${var}\b/_${var}/g" "$file"
            ;;
    esac
}

# Apply fixes
echo "=== Fixing unused imports ==="

# src/commands/provision.ts line 21 - DiskHealth import
sed -i '' '21s/, DiskHealth//' src/commands/provision.ts

# src/commands/provision.ts line 253 - IPMIResult type
sed -i '' '253s/^/\/\/ /' src/commands/provision.ts

# src/commands/recovery.ts line 7 - RecoverySystem, SuggestedFix, RecoveryOptions imports
sed -i '' '7s/, RecoverySystem//' src/commands/recovery.ts
sed -i '' '7s/, SuggestedFix//' src/commands/recovery.ts
sed -i '' '7s/, RecoveryOptions//' src/commands/recovery.ts

# src/lib/logger.ts line 7 - createInterface import
sed -i '' '7s/, createInterface//' src/lib/logger.ts

# src/lib/openclaude-service.ts line 16 - getConfigPaths import
sed -i '' '16s/, getConfigPaths//' src/lib/openclaude-service.ts

# src/lib/openclaw-service.ts line 19 - HestiaConfig type
sed -i '' '19s/^/\/\/ /' src/lib/openclaw-service.ts

# src/lib/openclaw-service.ts line 20 - getConfigPaths, saveConfig imports
sed -i '' '20s/, getConfigPaths//' src/lib/openclaw-service.ts
sed -i '' '20s/, saveConfig//' src/lib/openclaw-service.ts

# src/lib/os-manager.ts line 11 - spawn, ChildProcess imports
sed -i '' '11s/, spawn//' src/lib/os-manager.ts
sed -i '' '11s/, ChildProcess//' src/lib/os-manager.ts

# src/lib/package-service.ts line 10 - spawn import
sed -i '' '10s/, spawn//' src/lib/package-service.ts

# src/lib/package-service.ts line 29 - DockerComposeConfig type
sed -i '' '29s/^/\/\/ /' src/lib/package-service.ts

# src/lib/whodb-service.ts line 27 - YAML import
sed -i '' '27s/, YAML//' src/lib/whodb-service.ts

# src/lib/whodb-service.ts line 29 - getConfigPaths, updateConfig imports
sed -i '' '29s/, getConfigPaths//' src/lib/whodb-service.ts
sed -i '' '29s/, updateConfig//' src/lib/whodb-service.ts

echo "=== Fixing unused variables (prefixing with underscore) ==="

# Function to prefix unused variables with underscore
prefix_unused_var() {
    local file=$1
    local line=$2
    local var=$3
    
    # Prefix variable with underscore
    sed -i '' "${line}s/\b${var}\b/_${var}/g" "$file"
}

# Apply prefix fixes
prefix_unused_var "src/commands/add.ts" 34 "baseUrl"
prefix_unused_var "src/commands/add.ts" 35 "apiKey"
prefix_unused_var "src/commands/add.ts" 78 "packageConfig"
prefix_unused_var "src/commands/ai.ts" 405 "_transport"
prefix_unused_var "src/commands/extinguish.ts" 32 "baseUrl"
prefix_unused_var "src/commands/extinguish.ts" 33 "_apiKey"
prefix_unused_var "src/commands/ignite.ts" 29 "baseUrl"
prefix_unused_var "src/commands/ignite.ts" 30 "_apiKey"
prefix_unused_var "src/commands/provision.ts" 1506 "hardware"
prefix_unused_var "src/commands/provision.ts" 1583 "hardware"
prefix_unused_var "src/commands/recovery.ts" 133 "backupToRestore"
prefix_unused_var "src/commands/test.ts" 41 "showProgressBar"
prefix_unused_var "src/commands/test.ts" 177 "options"
prefix_unused_var "src/lib/ai-chat-service.ts" 29 "aiChatConfigSchema"
prefix_unused_var "src/lib/hardware-monitor.ts" 509 "stdout"
prefix_unused_var "src/lib/hardware-monitor.ts" 937 "stdout"
prefix_unused_var "src/lib/hardware-monitor.ts" 1064 "stdout"
prefix_unused_var "src/lib/hardware-monitor.ts" 1696 "stdout"
prefix_unused_var "src/lib/logger.ts" 21 "rl"
prefix_unused_var "src/lib/openclaude-service.ts" 15 "logger"
prefix_unused_var "src/lib/openclaude-service.ts" 19 "execAsync"
prefix_unused_var "src/lib/openclaw-service.ts" 1133 "config"
prefix_unused_var "src/lib/os-manager.ts" 16 "execAsync"
prefix_unused_var "src/lib/os-manager.ts" 345 "stats"
prefix_unused_var "src/lib/package-service.ts" 467 "stdout"
prefix_unused_var "src/lib/package-service.ts" 606 "manifest"
prefix_unused_var "src/lib/server-provisioner.ts" 1202 "updateProgress"
prefix_unused_var "src/lib/server-provisioner.ts" 1233 "parseSize"
prefix_unused_var "src/lib/server-provisioner.ts" 1292 "cidrToNetmask"
prefix_unused_var "src/lib/server-provisioner.ts" 1304 "checkRequiredTools"
prefix_unused_var "src/lib/server-provisioner.ts" 1327 "generateRecommendations"

echo "=== Cleaning up empty import statements ==="

# Remove any import lines that are now empty
find src -name "*.ts" -exec sed -i '' '/import.*{\s*}\s*from/d' {} \;

echo "=== Running TypeScript check to verify fixes ==="
npm run typecheck -- --strict --noUnusedLocals --noUnusedParameters

echo "Done!"
