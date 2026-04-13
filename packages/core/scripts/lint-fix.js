#!/usr/bin/env node

/**
 * Script to run ESLint with auto-fix on the entire codebase
 * This helps clean up unused variables, imports, and other code quality issues
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🚀 Running ESLint auto-fix on Hestia CLI...\n');

try {
  // Run ESLint with auto-fix
  execSync('npx eslint src --ext .ts --fix', {
    cwd: projectRoot,
    stdio: 'inherit'
  });
  
  console.log('\n✅ ESLint auto-fix completed successfully!');
  console.log('\nNext steps:');
  console.log('1. Review the changes made by ESLint');
  console.log('2. Run tests to ensure nothing is broken');
  console.log('3. Commit the cleaned-up code');
  
} catch (error) {
  console.error('\n❌ ESLint auto-fix failed!');
  console.error('Some issues may require manual fixing.');
  console.error('\nYou can run: npx eslint src --ext .ts');
  console.error('to see the remaining issues.');
  process.exit(1);
}