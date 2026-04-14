#!/usr/bin/env node
/**
 * Lightweight check that commands.manifest.yaml exists and lists expected categories.
 * Run: node scripts/check-manifest.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'commands.manifest.yaml');

if (!existsSync(manifestPath)) {
  console.error('Missing commands.manifest.yaml');
  process.exit(1);
}
const text = readFileSync(manifestPath, 'utf8');
for (const key of ['lifecycle', 'organs', 'debug', 'management', 'ai']) {
  if (!text.includes(key)) {
    console.error(`manifest missing category key: ${key}`);
    process.exit(1);
  }
}
console.log('commands.manifest.yaml OK');
