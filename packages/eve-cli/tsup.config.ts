import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  // `@eve/*` are WORKSPACE packages and are deliberately NOT external.
  //
  // They are never published to npm, so externalizing them produced a package
  // that installs and then cannot resolve a single internal import — `dist`
  // carried 80 unresolvable `@eve/*` references. Bundling them makes `@eve/cli`
  // self-contained, which is what lets ONE package be published instead of nine
  // that would each need public versioning forever.
  //
  // Everything below stays external on purpose: they are real npm dependencies
  // declared in package.json, and bundling them would duplicate code npm can
  // dedupe and break `execa`/`ora` native-ish behaviour.
  // Bundling workspace packages drags in their transitive CJS dependencies
  // (`ws`, reached via a socket client), and CJS does `require("events")` at
  // module scope. esbuild's ESM output replaces `require` with a shim that
  // THROWS — "Dynamic require of \"events\" is not supported" — so the binary
  // installed fine and then died on launch.
  //
  // esbuild's shim defers to a real `require` when one is in scope, so defining
  // it via createRequire is the fix. Without this, any future CJS dependency
  // reintroduces the same launch crash.
  banner: {
    js: "import { createRequire as __eveCreateRequire } from 'module'; const require = __eveCreateRequire(import.meta.url);",
  },
  external: [
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
