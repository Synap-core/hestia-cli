#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Fix imports in core TypeScript files to use @hestia packages
 */
function fixImportsInFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  
  let fixed = content;
  
  // Replace local types imports with @hestia/types
  fixed = fixed.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/lib\/types\/index['"]/g, "from '@hestia/types'");
  fixed = fixed.replace(/from\s+['"]\.\.\/\.\.\/lib\/types\/index['"]/g, "from '@hestia/types'");
  fixed = fixed.replace(/from\s+['"]\.\.\/lib\/types\/index['"]/g, "from '@hestia/types'");
  fixed = fixed.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/lib\/types\/index['"]/g, "from '@hestia/types'");
  
  // Replace local utils imports with @hestia/utils
  fixed = fixed.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/lib\/utils\/index['"]/g, "from '@hestia/utils'");
  fixed = fixed.replace(/from\s+['"]\.\.\/\.\.\/lib\/utils\/index['"]/g, "from '@hestia/utils'");
  fixed = fixed.replace(/from\s+['"]\.\.\/lib\/utils\/index['"]/g, "from '@hestia/utils'");
  fixed = fixed.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/lib\/utils\/index['"]/g, "from '@hestia/utils'");
  
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
console.log(`Fixing imports in: ${srcDir}`);
processDirectory(srcDir);
console.log('Import fixing complete!');