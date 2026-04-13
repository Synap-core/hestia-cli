const fs = require('fs');
const path = require('path');

// Read each file and fix specific lines
const fixes = [
  // src/commands/add.ts
  {
    file: 'src/commands/add.ts',
    fixes: [
      { line: 34, change: (line) => line.replace('baseUrl', '_baseUrl') },
      { line: 35, change: (line) => line.replace('apiKey', '_apiKey') },
      { line: 78, change: (line) => line.replace('packageConfig', '_packageConfig') }
    ]
  },
  // src/commands/ai.ts
  {
    file: 'src/commands/ai.ts',
    fixes: [
      { line: 405, change: (line) => line.replace('_transport', '__transport') }
    ]
  },
  // src/commands/extinguish.ts
  {
    file: 'src/commands/extinguish.ts',
    fixes: [
      { line: 32, change: (line) => line.replace('baseUrl', '_baseUrl') },
      { line: 33, change: (line) => line.replace('_apiKey', '__apiKey') }
    ]
  },
  // src/commands/ignite.ts
  {
    file: 'src/commands/ignite.ts',
    fixes: [
      { line: 29, change: (line) => line.replace('baseUrl', '_baseUrl') },
      { line: 30, change: (line) => line.replace('_apiKey', '__apiKey') }
    ]
  },
  // src/commands/provision.ts
  {
    file: 'src/commands/provision.ts',
    fixes: [
      { line: 21, change: (line) => {
        // Remove DiskHealth from import
        return line.replace(', DiskHealth', '');
      }},
      { line: 253, change: (line) => {
        // Comment out the entire IPMIResult interface
        // We'll handle this specially since it's multi-line
        return null; // Mark for special handling
      }},
      { line: 1506, change: (line) => line.replace('hardware', '_hardware') },
      { line: 1583, change: (line) => line.replace('hardware', '_hardware') }
    ]
  },
  // src/commands/recovery.ts
  {
    file: 'src/commands/recovery.ts',
    fixes: [
      { line: 7, change: (line) => {
        // Remove RecoverySystem, SuggestedFix, RecoveryOptions from import
        return line
          .replace(', RecoverySystem', '')
          .replace(', SuggestedFix', '')
          .replace(', RecoveryOptions', '');
      }},
      { line: 133, change: (line) => line.replace('backupToRestore', '_backupToRestore') }
    ]
  },
  // src/commands/test.ts
  {
    file: 'src/commands/test.ts',
    fixes: [
      { line: 41, change: (line) => line.replace('showProgressBar', '_showProgressBar') },
      { line: 177, change: (line) => line.replace('options', '_options') }
    ]
  },
  // src/lib/ai-chat-service.ts
  {
    file: 'src/lib/ai-chat-service.ts',
    fixes: [
      { line: 29, change: (line) => line.replace('aiChatConfigSchema', '_aiChatConfigSchema') }
    ]
  },
  // src/lib/hardware-monitor.ts
  {
    file: 'src/lib/hardware-monitor.ts',
    fixes: [
      { line: 509, change: (line) => line.replace('stdout', '_stdout') },
      { line: 937, change: (line) => line.replace('stdout', '_stdout') },
      { line: 1064, change: (line) => line.replace('stdout', '_stdout') },
      { line: 1696, change: (line) => line.replace('stdout', '_stdout') }
    ]
  },
  // src/lib/logger.ts
  {
    file: 'src/lib/logger.ts',
    fixes: [
      { line: 7, change: (line) => line.replace(', createInterface', '') },
      { line: 21, change: (line) => line.replace('rl', '_rl') }
    ]
  },
  // src/lib/openclaude-service.ts
  {
    file: 'src/lib/openclaude-service.ts',
    fixes: [
      { line: 15, change: (line) => line.replace('logger', '_logger') },
      { line: 16, change: (line) => line.replace(', getConfigPaths', '') },
      { line: 19, change: (line) => line.replace('execAsync', '_execAsync') }
    ]
  },
  // src/lib/openclaw-service.ts
  {
    file: 'src/lib/openclaw-service.ts',
    fixes: [
      { line: 19, change: (line) => {
        // Remove HestiaConfig type import
        return line.replace(', HestiaConfig', '');
      }},
      { line: 20, change: (line) => {
        // Remove getConfigPaths and saveConfig from import
        return line
          .replace(', getConfigPaths', '')
          .replace(', saveConfig', '');
      }},
      { line: 1133, change: (line) => line.replace('config', '_config') }
    ]
  },
  // src/lib/os-manager.ts
  {
    file: 'src/lib/os-manager.ts',
    fixes: [
      { line: 11, change: (line) => line.replace(', spawn', '').replace(', ChildProcess', '') },
      { line: 16, change: (line) => line.replace('execAsync', '_execAsync') },
      { line: 345, change: (line) => line.replace('stats', '_stats') }
    ]
  },
  // src/lib/package-service.ts
  {
    file: 'src/lib/package-service.ts',
    fixes: [
      { line: 10, change: (line) => line.replace(', spawn', '') },
      { line: 29, change: (line) => {
        // Remove DockerComposeConfig type
        return line.replace(', DockerComposeConfig', '');
      }},
      { line: 467, change: (line) => line.replace('stdout', '_stdout') },
      { line: 606, change: (line) => line.replace('manifest', '_manifest') }
    ]
  },
  // src/lib/server-provisioner.ts
  {
    file: 'src/lib/server-provisioner.ts',
    fixes: [
      { line: 1202, change: (line) => line.replace('updateProgress', '_updateProgress') },
      { line: 1233, change: (line) => line.replace('parseSize', '_parseSize') },
      { line: 1292, change: (line) => line.replace('cidrToNetmask', '_cidrToNetmask') },
      { line: 1304, change: (line) => line.replace('checkRequiredTools', '_checkRequiredTools') },
      { line: 1327, change: (line) => line.replace('generateRecommendations', '_generateRecommendations') }
    ]
  },
  // src/lib/whodb-service.ts
  {
    file: 'src/lib/whodb-service.ts',
    fixes: [
      { line: 27, change: (line) => line.replace(', YAML', '') },
      { line: 29, change: (line) => line.replace(', getConfigPaths', '').replace(', updateConfig', '') }
    ]
  }
];

// Apply fixes
for (const fileFix of fixes) {
  const filePath = path.join(process.cwd(), fileFix.file);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    continue;
  }
  
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  let modified = false;
  
  for (const fix of fileFix.fixes) {
    const lineIndex = fix.line - 1;
    if (lineIndex >= lines.length) {
      console.log(`Line ${fix.line} not found in ${filePath}`);
      continue;
    }
    
    const originalLine = lines[lineIndex];
    if (fix.change === null) {
      // Special handling for multi-line cases
      if (filePath.includes('provision.ts') && fix.line === 253) {
        // Comment out the entire IPMIResult interface (lines 253-258)
        for (let i = 252; i < 258; i++) {
          if (i < lines.length) {
            lines[i] = '// ' + lines[i];
          }
        }
        modified = true;
        console.log(`Commented out IPMIResult interface in ${filePath}`);
      }
    } else {
      const newLine = fix.change(originalLine);
      if (newLine !== originalLine) {
        lines[lineIndex] = newLine;
        modified = true;
        console.log(`Fixed line ${fix.line} in ${filePath}`);
      }
    }
  }
  
  if (modified) {
    fs.writeFileSync(filePath, lines.join('\n'));
  }
}

// Clean up empty import statements
console.log('\nCleaning up empty import statements...');
const tsFiles = [
  'src/commands/add.ts',
  'src/commands/provision.ts',
  'src/commands/recovery.ts',
  'src/lib/logger.ts',
  'src/lib/openclaude-service.ts',
  'src/lib/openclaw-service.ts',
  'src/lib/os-manager.ts',
  'src/lib/package-service.ts',
  'src/lib/whodb-service.ts'
];

for (const file of tsFiles) {
  const filePath = path.join(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    let lines = fs.readFileSync(filePath, 'utf8').split('\n');
    let modified = false;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('import') && lines[i].includes('{}')) {
        lines[i] = ''; // Remove empty import
        modified = true;
      }
    }
    
    if (modified) {
      // Remove empty lines caused by removing imports
      lines = lines.filter(line => line.trim() !== '');
      fs.writeFileSync(filePath, lines.join('\n'));
      console.log(`Cleaned empty imports in ${file}`);
    }
  }
}

console.log('\nDone! Run npm run typecheck to verify fixes.');
