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
  transpilePackages: ["@eve/dna", "@synap-core/auth"],
  // Phase 2 OS Home rebuild (2026-05-05). Legacy paths from the
  // pre-shell era either move into Settings as tabs or roll back to
  // the new Home. All redirects are 308 (permanent) so old bookmarks
  // resolve cleanly without a flash.
  async redirects() {
    return [
      // Stack Pulse — formerly the dashboard home, briefly a Settings
      // tab — is now the top-level Pulse app at `/pulse` (2026-05-05).
      { source: "/dashboard",                destination: "/pulse",                    permanent: true },
      { source: "/settings/stack-pulse",     destination: "/pulse",                    permanent: true },

      // Pre-Phase-2 dashboard sub-pages were already migrated under /settings.
      // Keep these in case anyone deep-linked one. Settings consolidation
      // (2026-05-05) removed agents/apps/channels/intents from /settings —
      // those redirects were dropped along with the destination folders.
      { source: "/dashboard/settings",       destination: "/settings",                 permanent: true },
      { source: "/dashboard/components",     destination: "/settings/components",      permanent: true },
      { source: "/dashboard/components/:id", destination: "/settings/components/:id",  permanent: true },
      { source: "/dashboard/ai",             destination: "/settings/ai",              permanent: true },
      { source: "/dashboard/networking",     destination: "/settings/networking",      permanent: true },
      { source: "/dashboard/doctor",         destination: "/settings/doctor",          permanent: true },

      // /apps used to live as a Settings tab; now the dedicated Marketplace
      // app owns every "browse / install / manage apps" surface.
      { source: "/apps",                     destination: "/marketplace",              permanent: true },
      { source: "/apps/:path*",              destination: "/marketplace",              permanent: true },
    ];
  },
};

export default nextConfig;
