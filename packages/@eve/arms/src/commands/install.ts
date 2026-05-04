import { Command } from 'commander';
import {
  EntityStateManager,
  entityStateManager,
  readAgentKeyOrLegacy,
  readEveSecrets,
} from '@eve/dna';
import { execa, resolveSynapDelegate } from '@eve/brain';
import { OpenClawService } from '../lib/openclaw.js';

export function installCommand(program: Command): void {
  program
    .command('install')
    .description('Install OpenClaw AI assistant')
    .action(async () => {
      try {
        console.log('🦾 Eve Arms - Installing OpenClaw...\n');

        const stateManager = new EntityStateManager();
        const state = await stateManager.getState();

        const brainStatus = state.organs.brain;
        if (brainStatus.state !== 'ready') {
          console.error('❌ Brain is not ready. Please run "eve brain init" first.');
          process.exit(1);
        }
        console.log('✅ Brain is ready');

        const synapPod = resolveSynapDelegate();
        if (synapPod) {
          console.log('✅ Synap Data Pod detected — using synap profiles + services\n');
          await execa('bash', [synapPod.synapScript, 'profiles', 'enable', 'openclaw'], {
            cwd: synapPod.repoRoot,
            env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir },
            stdio: 'inherit',
          });
          await execa('bash', [synapPod.synapScript, 'services', 'add', 'openclaw'], {
            cwd: synapPod.repoRoot,
            env: { ...process.env, SYNAP_DEPLOY_DIR: synapPod.deployDir, SYNAP_ASSUME_YES: '1' },
            stdio: 'inherit',
          });
          await stateManager.updateOrgan('arms', 'ready');
          // Write v2 component entry (managedBy: eve) alongside organ state
          await entityStateManager.updateComponentEntry('openclaw', {
            organ: 'arms',
            state: 'ready',
            version: '0.2.0',
            managedBy: 'eve',
          });
          console.log('\n🎉 OpenClaw provisioned via Synap.');
          console.log('   See: synap services status openclaw');
          return;
        }

        if (state.aiModel === 'none') {
          console.error('❌ Ollama is not configured. Please run "eve brain init --with-ai" first.');
          process.exit(1);
        }
        console.log('✅ Ollama is configured');

        const openclaw = new OpenClawService();
        await openclaw.install();
        const secrets = await readEveSecrets(process.cwd());
        const ollamaUrl =
          secrets?.inference?.gatewayUrl ??
          secrets?.inference?.ollamaUrl ??
          'http://eve-brain-ollama:11434';
        await openclaw.configure(ollamaUrl);
        // OpenClaw uses its own per-agent Hub key (see @eve/dna/agents.ts).
        // Honor the explicit override in secrets.arms.openclaw.synapApiKey,
        // otherwise read agents.openclaw.hubApiKey, otherwise legacy.
        const openclawSynapKey =
          secrets?.arms?.openclaw?.synapApiKey ??
          (await readAgentKeyOrLegacy('openclaw', process.cwd()));
        openclaw.setIntegration({
          synapApiUrl: secrets?.synap?.apiUrl,
          synapApiKey: openclawSynapKey,
          dokployApiUrl: secrets?.builder?.dokployApiUrl,
        });
        await openclaw.start();

        await stateManager.updateOrgan('arms', 'ready');

        console.log('\n🎉 OpenClaw installed successfully!');
        console.log('   Access it at: http://localhost:3000');
        console.log('\n   Next steps:');
        console.log('   - eve arms mcp list        # List MCP servers');
        console.log('   - eve arms mcp preset      # Install an MCP server preset');
        console.log('   - eve arms messaging configure # Configure messaging bridge');
        console.log('   - eve arms voice configure   # Configure voice/telephony');
      } catch (error) {
        console.error('❌ Installation failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
