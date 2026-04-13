#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Final fix for imports with specific rules
 */
function fixImportsInFile(filePath) {
  let content = readFileSync(filePath, 'utf8');
  let changed = false;
  
  // Determine correct relative path based on file location
  let utilsPath = '';
  let typesPath = '';
  
  if (filePath.includes('/domains/ai/')) {
    // ai is deeper: ../../../lib/
    utilsPath = '../../../lib/utils/index.js';
    typesPath = '../../../lib/types/index.js';
  } else if (filePath.includes('/domains/') && !filePath.includes('/domains/ai/')) {
    // Other domains: ../../lib/
    utilsPath = '../../lib/utils/index.js';
    typesPath = '../../lib/types/index.js';
  } else if (filePath.includes('/commands/')) {
    // commands directory: ../lib/
    utilsPath = '../lib/utils/index.js';
    typesPath = '../lib/types/index.js';
  } else if (filePath.includes('/lib/')) {
    // Already in lib: ./ or ../ based on depth
    if (filePath.includes('/lib/utils/') || filePath.includes('/lib/types/')) {
      // Within utils/types: relative imports within same lib
      return; // Don't change
    } else {
      // Other lib files: ../utils/ or ../types/
      utilsPath = '../utils/index.js';
      typesPath = '../types/index.js';
    }
  } else {
    // Root level files: ./lib/
    utilsPath = './lib/utils/index.js';
    typesPath = './lib/types/index.js';
  }
  
  // Replace imports with correct paths
  const oldContent = content;
  
  // Replace all imports that point to wrong paths
  content = content.replace(/from\s+['"][^'"]*lib\/utils\/index(\.js)?['"]/g, `from '${utilsPath}'`);
  content = content.replace(/from\s+['"][^'"]*lib\/types\/index(\.js)?['"]/g, `from '${typesPath}'`);
  
  // Also fix @hestia imports
  content = content.replace(/from\s+['"]@hestia\/utils['"]/g, `from '${utilsPath}'`);
  content = content.replace(/from\s+['"]@hestia\/types['"]/g, `from '${typesPath}'`);
  
  if (content !== oldContent) {
    console.log(`Fixed ${filePath}: utils='${utilsPath}', types='${typesPath}'`);
    writeFileSync(filePath, content, 'utf8');
  }
}

/**
 * Recursively process all .ts files
 */
function processDirectory(dirPath) {
  const files = readdirSync(dirPath);
  
  for (const file of files) {
    const fullPath = join(dirPath, file);
    const stats = statSync(fullPath);
    
    if (stats.isDirectory()) {
      processDirectory(fullPath);
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      fixImportsInFile(fullPath);
    }
  }
}

// Main execution
const srcDir = join(process.cwd(), 'src');
console.log(`Final import fix in: ${srcDir}`);
processDirectory(srcDir);
console.log('Done!');