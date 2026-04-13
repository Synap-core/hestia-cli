/**
 * services command - Manage optional Hestia services
 *
 * Commands:
 *   hestia services              - List all services (core + optional)
 *   hestia services:list           - List with status
 *   hestia services:available      - Show available optional services
 *   hestia services:install <n>    - Install optional service
 *   hestia services:remove <n>     - Remove service
 *   hestia services:start <n>      - Start service
 *   hestia services:stop <n>       - Stop service
 *   hestia services:status <n>     - Detailed status
 *   hestia services:enable <n>      - Enable service
 *   hestia services:disable <n>     - Disable service
 *   hestia services:configure <n>  - Configure service
 *   hestia services:logs <n>        - Show logs
 */
import { Command } from 'commander';
export declare function servicesCommand(program: Command): void;
//# sourceMappingURL=services.d.ts.map