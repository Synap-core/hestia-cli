/**
 * provision command - Bare metal server provisioning with Hestia
 * Usage: hestia provision [subcommand]
 *
 * Subcommands:
 *   provision (default) - Interactive server provisioning wizard
 *   provision:hardware - Hardware detection
 *   provision:diagnose - Hardware diagnostics
 *   provision:profile - Profile management
 *   provision:plan - Installation planning
 *   provision:usb - Create USB for this server
 *   provision:benchmark - Benchmark server
 *   provision:cluster - Multi-server setup
 *   provision:report - Generate provision report
 */
import { Command } from 'commander';
export declare function provisionCommand(program: Command): void;
//# sourceMappingURL=provision.d.ts.map