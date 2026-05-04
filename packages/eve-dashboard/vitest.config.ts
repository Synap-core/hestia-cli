import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Vitest config for the Eve dashboard.
 *
 * Tests live next to the code they cover (e.g.
 * `app/(home)/lib/__tests__/*.test.ts`). We run them in jsdom so the
 * browser-only OAuth helpers (sessionStorage, crypto.subtle) work
 * without ceremony.
 *
 * The `@/` alias mirrors the Next.js tsconfig path mapping so test
 * imports use the same shape as the production code.
 */
export default defineConfig({
  test: {
    globals: false,
    // Pure node environment — our smoke tests stub the small slice of
    // DOM they need (sessionStorage). This avoids pulling jsdom /
    // happy-dom into the dashboard's deps just for one suite.
    environment: "node",
    include: ["app/**/__tests__/**/*.test.ts", "app/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(here, "."),
    },
  },
});
