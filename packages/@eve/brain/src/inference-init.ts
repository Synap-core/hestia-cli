import { EntityStateManager } from '@eve/dna';
import { InferenceGateway } from '@eve/legs';
import { OllamaService } from './lib/ollama.js';
import { execa } from './lib/exec.js';

export interface InferenceInitOptions {
  model?: string;
  /** When true (default), start Traefik gateway on port 11435 with Basic auth. */
  withGateway?: boolean;
  /** When true with gateway, do not publish Ollama on host (Full stack / Synap coexists). */
  internalOllamaOnly?: boolean;
}

async function ensureNetwork(): Promise<void> {
  try {
    const { stdout } = await execa('docker', ['network', 'ls', '--format', '{{.Name}}']);
    if (!stdout.includes('eve-network')) {
      console.log('Creating eve-network...');
      await execa('docker', ['network', 'create', 'eve-network']);
    }
  } catch (error) {
    console.warn('Could not ensure Docker network:', error);
  }
}

/**
 * Inference-only profile: Ollama on Docker + optional Traefik gateway (Basic auth, default :11435).
 */
export async function runInferenceInit(options: InferenceInitOptions = {}): Promise<void> {
  const withGateway = options.withGateway !== false;
  const internalOnly = Boolean(options.internalOllamaOnly);

  await ensureNetwork();

  const ollama = new OllamaService();
  await ollama.install();
  await ollama.start({ publishToHost: !internalOnly });

  const model = options.model ?? 'llama3.1:8b';
  await ollama.pullModel(model, { publishToHost: !internalOnly });

  if (withGateway) {
    const gw = new InferenceGateway();
    const result = await gw.ensure();
    console.log('\nInference gateway (Traefik)');
    console.log(`  URL:      ${result.publicUrl}`);
    console.log(`  User:     ${result.username}`);
    console.log(`  Password: ${result.password}`);
    console.log(`  Secrets:  ${result.secretsFile}`);
    console.log(`  Test:     curl -u '${result.username}:${result.password}' ${result.publicUrl}/api/tags`);
    const stateManager = new EntityStateManager();
    await stateManager.updateOrgan('legs', 'ready');
  }

  const stateManager = new EntityStateManager();
  await stateManager.setAIModel('ollama');
  await stateManager.updateOrgan('brain', 'ready');

  console.log('\nInference profile ready.');
}
