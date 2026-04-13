#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

/**
 * Fix all imports in core TypeScript files to use correct relative paths
 */
function fixImportsInFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  
  let fixed = content;
  let changed = false;
  
  // Calculate correct relative path from file to lib/utils/index.js
  const relativeToLib = (targetFile, fromDir) => {
    const relPath = relative(fromDir, targetFile);
    const path = relPath.startsWith('.') ? relPath : './' + relPath;
    return path.replace(/\.ts$/, '.js');
  };
  
  // Fix imports to lib/utils/index.js
  const utilsImportRegex = /from\s+['"](@hestia\/utils|\.\.\/\.\.\/lib\/utils\/index|\.\.\/lib\/utils\/index)['"]/g;
  fixed = fixed.replace(utilsImportRegex, (match, importPath) => {
    changed = true;
    // Calculate correct relative path
    const fileDir = dirname(filePath);
    const libUtilsPath = join(process.cwd(), 'src/lib/utils/index.js');
    const relPath = relative(fileDir, libUtilsPath);
    return `from '${relPath}'`;
  });
  
  // Fix imports to lib/types/index.js
  const typesImportRegex = /from\s+['"](@hestia\/types|\.\.\/\.\.\/lib\/types\/index|\.\.\/lib\/types\/index)['"]/g;
  fixed = fixed.replace(typesImportRegex, (match, importPath) => {
    changed = true;
    // Calculate correct relative path
    const fileDir = dirname(filePath);
    const libTypesPath = join(process.cwd(), 'src/lib/types/index.js');
    const relPath = relative(fileDir, libTypesPath);
    return `from '${relPath}'`;
  });
  
  if (changed) {
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
console.log(`Fixing all imports in: ${srcDir}`);
processDirectory(srcDir);
console.log('All imports fixed!');