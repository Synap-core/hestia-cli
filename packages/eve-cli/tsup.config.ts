import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  external: [
    /^@eve\//,
    'commander',
    'chalk',
    'ora',
    'execa',
    'cli-table3',
    'boxen',
    '@clack/prompts',
    'cli-progress',
  ],
});
