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
};

export default nextConfig;
