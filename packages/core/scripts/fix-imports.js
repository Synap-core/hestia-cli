#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Fix imports in compiled JavaScript files to add .js extensions
 * This is needed for Node.js ES modules when using moduleResolution: "bundler"
 */
function fixImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  
  // Regex to match relative imports without .js extension
  // Matches: from '\./something' or from '\.\./something'
  // But not: from '\./something.js' or from '\.\./something.js'
  const importRegex = /from\s+['"](\.{1,2}\/[^'"]+?)(?<!\.js)['"]/g;
  const exportRegex = /export\s+\*\s+from\s+['"](\.{1,2}\/[^'"]+?)(?<!\.js)['"]/g;
  
  let fixed = content;
  let changed = false;
  
  // Fix imports
  fixed = fixed.replace(importRegex, (match, importPath) => {
    changed = true;
    return `from '${importPath}.js'`;
  });
  
  // Fix export * from
  fixed = fixed.replace(exportRegex, (match, importPath) => {
    changed = true;
    return `export * from '${importPath}.js'`;
  });
  
  if (changed) {
    console.log(`Fixed imports in: ${filePath}`);
    writeFileSync(filePath, fixed, 'utf8');
  }
}

/**
 * Recursively process all .js files in a directory
 */
function processDirectory(dirPath) {
  const files = readdirSync(dirPath);
  
  for (const file of files) {
    const fullPath = join(dirPath, file);
    const stats = statSync(fullPath);
    
    if (stats.isDirectory()) {
      processDirectory(fullPath);
    } else if (file.endsWith('.js')) {
      fixImports(fullPath);
    }
  }
}

// Main execution
const distDir = join(process.cwd(), 'dist');
console.log(`Fixing imports in: ${distDir}`);
processDirectory(distDir);
console.log('Import fixing complete!');