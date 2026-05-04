import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Anchor the standalone trace at the workspace root so the output tree is
// `<root>/packages/eve-dashboard/...` instead of the host's absolute path.
const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(here, "..", "..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@eve/dna"],
  // Phase 2 route refactor (2026-05-05): existing /dashboard/<sub> pages
  // moved under /settings/<sub>. /dashboard (the stack-pulse home) stays
  // until the new OS Home replaces it in the next sprint.
  async redirects() {
    return [
      // Map the old /dashboard/settings catch-all to the top-level /settings.
      // (Has to come BEFORE the generic /dashboard/:path* rule below.)
      { source: "/dashboard/settings",       destination: "/settings",            permanent: true },
      { source: "/dashboard/components",     destination: "/settings/components", permanent: true },
      { source: "/dashboard/components/:id", destination: "/settings/components/:id", permanent: true },
      { source: "/dashboard/channels",       destination: "/settings/channels",   permanent: true },
      { source: "/dashboard/ai",             destination: "/settings/ai",         permanent: true },
      { source: "/dashboard/networking",     destination: "/settings/networking", permanent: true },
      { source: "/dashboard/doctor",         destination: "/settings/doctor",     permanent: true },
    ];
  },
};

export default nextConfig;
