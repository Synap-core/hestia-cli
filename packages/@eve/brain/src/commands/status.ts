import type { Command } from 'commander';

import { execSync } from 'node:child_process';
import { OllamaService } from '../lib/ollama.js';
import { resolveSynapDelegate } from '../lib/synap-delegate.js';
import { execa } from '../lib/exec.js';

/** Check Synap container status via Docker (works without repo checkout). */
function checkSynapViaDocker(): { found: boolean; healthy: boolean; containers: string[] } {
  try {
    const out = execSync(
      'docker ps -a --filter "label=com.docker.compose.project=synap-backend" --format "{{.Names}}|{{.Status}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    const lines = out.split('\n').filter(Boolean);
    if (lines.length === 0) return { found: false, healthy: false, containers: [] };

    const containers: string[] = [];
    let healthy = false;
    for (const line of lines) {
      const [name, status] = line.split('|');
      containers.push(name);
      if (status?.includes('healthy')) healthy = true;
      else if (status?.includes('running')) healthy = false;
    }
    return { found: true, healthy, containers };
  } catch {
    return { found: false, healthy: false, containers: [] };
  }
}

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Show brain health status')
    .action(async () => {
      try {
        console.log('Checking brain health...\n');

        const delegate = resolveSynapDelegate();
        if (delegate) {
          // Full check via repo health script
          try {
            await execa('bash', [delegate.synapScript, 'health'], {
              cwd: delegate.repoRoot,
              env: { ...process.env, SYNAP_DEPLOY_DIR: delegate.deployDir },
              stdio: 'inherit',
            });
          } catch {
            // Script failed — fall through to Docker fallback
          }
        }

        // Always supplement with Docker container status
        const synap = checkSynapViaDocker();
        if (!synap.found) {
          console.log('⚠️ Synap Data Pod: not found');
          if (!delegate) {
            console.log('  Set SYNAP_REPO_ROOT or run `eve brain init --synap-repo <path>`');
          }
        } else {
          const mark = synap.healthy ? '✓' : '⚠';
          const label = synap.healthy ? 'Healthy' : 'Running (not yet healthy)';
          console.log(`${mark} Synap Data Pod: ${label}`);
          for (const c of synap.containers) {
            console.log(`    - ${c}`);
          }
        }

        // Check hermes (builder organ)
        try {
          const hermesStatus = execSync(
            'docker inspect eve-builder-hermes --format "{{.State.Status}}" 2>/dev/null',
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
          ).trim();
          const mark = hermesStatus === 'running' ? '✓' : '⚠';
          console.log(`${mark} Hermes (agent): ${hermesStatus || 'not found'}`);
        } catch {
          console.log('⚠️ Hermes (agent): not found');
        }

        const ollama = new OllamaService();
        const ollamaStatus = await ollama.getStatus();
        if (ollamaStatus.running) {
          console.log('AI Models');
          if (ollamaStatus.modelsInstalled.length > 0) {
            for (const model of ollamaStatus.modelsInstalled) {
              const current = model === ollamaStatus.currentModel ? ' (current)' : '';
              console.log(`  • ${model}${current}`);
            }
          } else {
            console.log('  No models installed');
            console.log('  Run: eve brain init --with-ai --model <model>');
          }
        }
      } catch (error) {
        console.error('Failed to check brain status:', error);
        process.exit(1);
      }
    });
}
