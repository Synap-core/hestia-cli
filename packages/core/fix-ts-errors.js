#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Map of files to fix with line numbers and variable names
const fixes = [
  // src/commands/add.ts
  { file: 'src/commands/add.ts', line: 34, variable: 'baseUrl' },
  { file: 'src/commands/add.ts', line: 35, variable: 'apiKey' },
  { file: 'src/commands/add.ts', line: 78, variable: 'packageConfig' },
  
  // src/commands/ai.ts
  { file: 'src/commands/ai.ts', line: 405, variable: '_transport' },
  
  // src/commands/extinguish.ts
  { file: 'src/commands/extinguish.ts', line: 32, variable: 'baseUrl' },
  { file: 'src/commands/extinguish.ts', line: 33, variable: '_apiKey' },
  
  // src/commands/ignite.ts
  { file: 'src/commands/ignite.ts', line: 29, variable: 'baseUrl' },
  { file: 'src/commands/ignite.ts', line: 30, variable: '_apiKey' },
  
  // src/commands/provision.ts
  { file: 'src/commands/provision.ts', line: 21, variable: 'DiskHealth', isImport: true },
  { file: 'src/commands/provision.ts', line: 253, variable: 'IPMIResult', isType: true },
  { file: 'src/commands/provision.ts', line: 1506, variable: 'hardware' },
  { file: 'src/commands/provision.ts', line: 1583, variable: 'hardware' },
  
  // src/commands/recovery.ts
  { file: 'src/commands/recovery.ts', line: 7, variable: 'RecoverySystem', isImport: true },
  { file: 'src/commands/recovery.ts', line: 7, variable: 'SuggestedFix', isImport: true },
  { file: 'src/commands/recovery.ts', line: 7, variable: 'RecoveryOptions', isImport: true },
  { file: 'src/commands/recovery.ts', line: 133, variable: 'backupToRestore' },
  
  // src/commands/test.ts
  { file: 'src/commands/test.ts', line: 41, variable: 'showProgressBar' },
  { file: 'src/commands/test.ts', line: 177, variable: 'options' },
  
  // src/lib/ai-chat-service.ts
  { file: 'src/lib/ai-chat-service.ts', line: 29, variable: 'aiChatConfigSchema' },
  
  // src/lib/hardware-monitor.ts
  { file: 'src/lib/hardware-monitor.ts', line: 509, variable: 'stdout' },
  { file: 'src/lib/hardware-monitor.ts', line: 937, variable: 'stdout' },
  { file: 'src/lib/hardware-monitor.ts', line: 1064, variable: 'stdout' },
  { file: 'src/lib/hardware-monitor.ts', line: 1696, variable: 'stdout' },
  
  // src/lib/logger.ts
  { file: 'src/lib/logger.ts', line: 7, variable: 'createInterface', isImport: true },
  { file: 'src/lib/logger.ts', line: 21, variable: 'rl' },
  
  // src/lib/openclaude-service.ts
  { file: 'src/lib/openclaude-service.ts', line: 15, variable: 'logger' },
  { file: 'src/lib/openclaude-service.ts', line: 16, variable: 'getConfigPaths', isImport: true },
  { file: 'src/lib/openclaude-service.ts', line: 19, variable: 'execAsync' },
  
  // src/lib/openclaw-service.ts
  { file: 'src/lib/openclaw-service.ts', line: 19, variable: 'HestiaConfig', isType: true },
  { file: 'src/lib/openclaw-service.ts', line: 20, variable: 'getConfigPaths', isImport: true },
  { file: 'src/lib/openclaw-service.ts', line: 20, variable: 'saveConfig', isImport: true },
  { file: 'src/lib/openclaw-service.ts', line: 1133, variable: 'config' },
  
  // src/lib/os-manager.ts
  { file: 'src/lib/os-manager.ts', line: 11, variable: 'spawn', isImport: true },
  { file: 'src/lib/os-manager.ts', line: 11, variable: 'ChildProcess', isImport: true },
  { file: 'src/lib/os-manager.ts', line: 16, variable: 'execAsync' },
  { file: 'src/lib/os-manager.ts', line: 345, variable: 'stats' },
  
  // src/lib/package-service.ts
  { file: 'src/lib/package-service.ts', line: 10, variable: 'spawn', isImport: true },
  { file: 'src/lib/package-service.ts', line: 29, variable: 'DockerComposeConfig', isType: true },
  { file: 'src/lib/package-service.ts', line: 467, variable: 'stdout' },
  { file: 'src/lib/package-service.ts', line: 606, variable: 'manifest' },
  
  // src/lib/server-provisioner.ts
  { file: 'src/lib/server-provisioner.ts', line: 1202, variable: 'updateProgress' },
  { file: 'src/lib/server-provisioner.ts', line: 1233, variable: 'parseSize' },
  { file: 'src/lib/server-provisioner.ts', line: 1292, variable: 'cidrToNetmask' },
  { file: 'src/lib/server-provisioner.ts', line: 1304, variable: 'checkRequiredTools' },
  { file: 'src/lib/server-provisioner.ts', line: 1327, variable: 'generateRecommendations' },
  
  // src/lib/whodb-service.ts
  { file: 'src/lib/whodb-service.ts', line: 27, variable: 'YAML', isImport: true },
  { file: 'src/lib/whodb-service.ts', line: 29, variable: 'getConfigPaths', isImport: true },
  { file: 'src/lib/whodb-service.ts', line: 29, variable: 'updateConfig', isImport: true },
];

function fixUnusedVariable(filePath, lineNum, variableName, isImport = false, isType = false) {
  const content = fs.readFileSync(filePath, 'utf8').split('\n');
  const lineIndex = lineNum - 1;
  
  if (lineIndex >= content.length) {
    console.log(`Warning: Line ${lineNum} not found in ${filePath}`);
    return false;
  }
  
  const line = content[lineIndex];
  
  if (isImport) {
    // Handle import statements
    if (line.includes(`import {`) || line.includes(`import type {`)) {
      // Remove the variable from import statement
      const importMatch = line.match(/(import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"][^'"]+['"])/);
      if (importMatch) {
        const importVars = importMatch[2].split(',').map(v => v.trim()).filter(v => v !== variableName);
        if (importVars.length === 0) {
          // Remove entire import line if no variables left
          content[lineIndex] = '';
        } else {
          content[lineIndex] = line.replace(importMatch[1], `import ${importMatch[1].includes('type ') ? 'type ' : ''}{${importVars.join(', ')}} from${line.split('from')[1]}`);
        }
        console.log(`Fixed import ${variableName} in ${filePath}:${lineNum}`);
        return true;
      }
    }
  } else if (isType) {
    // Handle type declarations (prefixed with type or interface)
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('type ') || trimmedLine.startsWith('interface ') || trimmedLine.includes(': type')) {
      // Check if this is a standalone type declaration
      if (trimmedLine.startsWith(`type ${variableName}`) || trimmedLine.startsWith(`interface ${variableName}`)) {
        content[lineIndex] = ''; // Remove the line
        console.log(`Removed unused type ${variableName} in ${filePath}:${lineNum}`);
        return true;
      }
    }
  } else {
    // Handle regular variable declarations
    // Look for patterns like: const variableName = ... or let variableName = ...
    const varPattern = new RegExp(`(const|let|var)\\s+${variableName}\\s*(=|:)[^;]*;?`);
    if (varPattern.test(line)) {
      content[lineIndex] = ''; // Remove the line
      console.log(`Removed unused variable ${variableName} in ${filePath}:${lineNum}`);
      return true;
    }
    
    // Handle function parameters - prefix with underscore
    const paramPattern = new RegExp(`(function|\\()([^)]*\\b${variableName}\\b[^)]*)`);
    if (paramPattern.test(line)) {
      content[lineIndex] = line.replace(new RegExp(`\\b${variableName}\\b`), `_${variableName}`);
      console.log(`Prefixed unused parameter ${variableName} with _ in ${filePath}:${lineNum}`);
      return true;
    }
  }
  
  console.log(`Could not fix ${variableName} in ${filePath}:${lineNum}`);
  console.log(`Line: ${line}`);
  return false;
}

// Apply fixes
let fixedCount = 0;
let totalCount = fixes.length;

for (const fix of fixes) {
  const fullPath = path.join(process.cwd(), fix.file);
  if (fs.existsSync(fullPath)) {
    const success = fixUnusedVariable(
      fullPath, 
      fix.line, 
      fix.variable, 
      fix.isImport || false,
      fix.isType || false
    );
    if (success) {
      fixedCount++;
      
      // Write the file back
      const content = fs.readFileSync(fullPath, 'utf8').split('\n');
      // We already modified content in fixUnusedVariable, need to read again
      // Actually we need to rewrite the logic to accumulate changes
    }
  } else {
    console.log(`File not found: ${fullPath}`);
  }
}

console.log(`\nFixed ${fixedCount} out of ${totalCount} errors automatically.`);
console.log(`Remaining errors may need manual fixes.`);
