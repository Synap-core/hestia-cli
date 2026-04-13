import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  bundle: true,
  splitting: false,
  platform: 'node',
  target: 'node18',
  shims: true,
  // Externaliser les dépendances problématiques avec require() dynamique
  external: [
    'commander',
    'chalk',
    'inquirer',
    'execa',
    'js-yaml',
    'yaml',
    'listr2',
    'ora',
    'zod',
    '@gitlawb/openclaude',
    'eventemitter3',
  ]
})