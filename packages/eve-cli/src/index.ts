import { Command } from 'commander';
import { setupCommand } from './commands/setup.js';
import { setupAdminCommand } from './commands/setup-admin.js';
import { setupOmniRouteCommand } from './commands/setup-omniroute.js';
import { doctorCommand } from './commands/doctor.js';
import { authCommand } from './commands/auth.js';
import { loginCommand } from './commands/login.js';
import { growCommand } from './commands/grow.js';
import { uiCommand } from './commands/ui.js';
import { statusCommand } from './commands/status.js';
import { lsCommand } from './commands/ls.js';
import { synapCommand } from './commands/synap.js';
import { deployCommand } from './commands/deploy.js';
import { removeCommand } from './commands/remove.js';
import { aiCommandGroup } from './commands/ai.js';
import { capabilitiesCommand } from './commands/capabilities.js';
import { connectorsCommand } from './commands/connectors.js';
import { openwebuiCommand } from './commands/openwebui.js';
import { domainCommand } from './commands/domain.js';
import { addCommand } from './commands/add.js';
import { installCommand } from './commands/lifecycle/install.js';
import { birthCommand } from './commands/lifecycle/birth.js';
import { purgeCommand } from './commands/manage/purge.js';
import { readEveSecrets } from '@eve/dna';
import { printHeader, printInfo, printSuccess, printWarning, printError } from './lib/ui.js';
const version = "0.1.0";

const program = new Command()
  .name('eve')
  .description('Eve - Entity Creation System. AI-powered sovereign infrastructure.')
  .version(version)
  .option('-j, --json', 'Output as JSON')
  .option('-v, --verbose', 'Verbose output')
  .hook('preAction', async (thisCommand, actionCommand) => {
    // Load secrets for commands that need pod access
    const secrets = await readEveSecrets();
    if (secrets) {
      (actionCommand as any).eveSecrets = secrets;
    }
  });

// Register all commands
setupCommand(program);
setupAdminCommand(program);
setupOmniRouteCommand(program);
doctorCommand(program);
authCommand(program);
loginCommand(program);
growCommand(program);
uiCommand(program);
statusCommand(program);
lsCommand(program);
synapCommand(program);
deployCommand(program);
removeCommand(program);
aiCommandGroup(program);
capabilitiesCommand(program);
connectorsCommand(program);
openwebuiCommand(program);
domainCommand(program);
addCommand(program);
installCommand(program);
birthCommand(program);
purgeCommand(program);

// Global error handler
program.exitOverride((err) => {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.versionDisplayed') {
    process.exit(0);
  }
  printError(err.message);
  process.exit(1);
});

program.parseAsync(process.argv).catch((err) => {
  printError(err.message);
  process.exit(1);
});
