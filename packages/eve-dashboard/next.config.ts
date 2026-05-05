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
  // Phase 2 OS Home rebuild (2026-05-05). Legacy paths from the
  // pre-shell era either move into Settings as tabs or roll back to
  // the new Home. All redirects are 308 (permanent) so old bookmarks
  // resolve cleanly without a flash.
  async redirects() {
    return [
      // Stack Pulse — formerly the dashboard home — is now a Settings tab.
      { source: "/dashboard",                destination: "/settings/stack-pulse", permanent: true },

      // Pre-Phase-2 dashboard sub-pages were already migrated under /settings.
      // Keep these in case anyone deep-linked one.
      { source: "/dashboard/settings",       destination: "/settings",                 permanent: true },
      { source: "/dashboard/components",     destination: "/settings/components",      permanent: true },
      { source: "/dashboard/components/:id", destination: "/settings/components/:id",  permanent: true },
      { source: "/dashboard/channels",       destination: "/settings/channels",        permanent: true },
      { source: "/dashboard/ai",             destination: "/settings/ai",              permanent: true },
      { source: "/dashboard/networking",     destination: "/settings/networking",      permanent: true },
      { source: "/dashboard/doctor",         destination: "/settings/doctor",          permanent: true },

      // Top-level surfaces that used to live on the legacy AppShell
      // sidebar — now Settings tabs.
      { source: "/intents",                  destination: "/settings/intents",         permanent: true },
      { source: "/intents/:path*",           destination: "/settings/intents/:path*",  permanent: true },
      { source: "/apps",                     destination: "/settings/apps",            permanent: true },
      { source: "/apps/:path*",              destination: "/settings/apps/:path*",     permanent: true },

      // /agents at the top level is now the live Agents app stub.
      // Deep-linked terminals (which used to live there) are now under
      // /settings/agents/<slug>/terminal.
      { source: "/agents/:slug/terminal",    destination: "/settings/agents/:slug/terminal", permanent: true },
    ];
  },
};

export default nextConfig;
