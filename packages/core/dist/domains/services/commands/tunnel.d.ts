/**
 * tunnel command - Secure Remote Access Management
 * Usage: hestia tunnel [subcommand]
 *
 * Manages secure tunnel access to Hestia nodes using Pangolin.
 * Pangolin is a self-hosted WireGuard-based tunneling solution that works
 * behind CGNAT without third-party dependencies.
 *
 * Subcommands:
 *   tunnel (default) - Show tunnel status
 *   tunnel:enable    - Interactive tunnel setup
 *   tunnel:disable   - Disable tunnel
 *   tunnel:status    - Show detailed status
 *   tunnel:url       - Show public URL
 *   tunnel:logs      - Show/follow tunnel logs
 *
 * Quick Start:
 *   1. On VPS: hestia tunnel:enable --mode server
 *   2. On Home: hestia tunnel:enable --mode client --server <vps-ip>
 *   3. Access home via https://tunnel.yourdomain.com
 *
 * Why Pangolin?
 *   - Self-hosted (no Cloudflare dependency)
 *   - WireGuard-based (fast, secure)
 *   - Works behind CGNAT
 *   - Identity-aware access
 *   - Optional component (not required)
 */
import { Command } from 'commander';
export declare function tunnelCommand(program: Command): void;
//# sourceMappingURL=tunnel.d.ts.map