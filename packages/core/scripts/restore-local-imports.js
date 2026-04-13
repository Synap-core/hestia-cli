#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Restore local imports in core TypeScript files (from @hestia packages back to local)
 */
function fixImportsInFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  
  let fixed = content;
  
  // Replace @hestia/types imports with local imports
  fixed = fixed.replace(/from\s+['"]@hestia\/types['"]/g, "from '../../lib/types/index.js'");
  fixed = fixed.replace(/from\s+['"]@hestia\/utils['"]/g, "from '../../lib/utils/index.js'");
  
  // Fix deeper imports
  fixed = fixed.replace(/from\s+['"]@hestia\/types['"]/g, (match) => {
    // Check context to determine relative path
    if (filePath.includes('domains/ai/')) {
      return "from '../../../lib/types/index.js'";
    } else if (filePath.includes('domains/')) {
      return "from '../../lib/types/index.js'";
    }
    return "from '../lib/types/index.js'";
  });
  
  fixed = fixed.replace(/from\s+['"]@hestia\/utils['"]/g, (match) => {
    if (filePath.includes('domains/ai/')) {
      return "from '../../../lib/utils/index.js'";
    } else if (filePath.includes('domains/')) {
      return "from '../../lib/utils/index.js'";
    }
    return "from '../lib/utils/index.js'";
  });
  
  if (fixed !== content) {
    console.log(`Fixed imports in: ${filePath}`);
    writeFileSync(filePath, fixed, 'utf8');
  }
}

/**
 * Recursively process all .ts files in a directory
 */
function processDirectory(dirPath) {
  const files = readdirSync(dirPath);
  
  for (const file of files) {
    const fullPath = join(dirPath, file);
    const stats = statSync(fullPath);
    
    if (stats.isDirectory()) {
      processDirectory(fullPath);
    } else if (file.endsWith('.ts')) {
      fixImportsInFile(fullPath);
    }
  }
}

// Main execution
const srcDir = join(process.cwd(), 'src');
console.log(`Restoring local imports in: ${srcDir}`);
processDirectory(srcDir);
console.log('Import restoration complete!');