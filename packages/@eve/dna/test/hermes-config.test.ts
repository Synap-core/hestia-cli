import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { EveSecrets } from '../src/secrets-contract.js';

const osMock = vi.hoisted(() => ({ home: '' }));
type HermesYaml = {
  memory?: unknown;
  model?: {
    provider?: unknown;
    default?: unknown;
    base_url?: unknown;
    api_key?: unknown;
  };
  api_server?: unknown;
};

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => osMock.home,
  };
});

vi.mock('../src/reconcile.js', () => ({
  reconcile: vi.fn(async () => undefined),
}));

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe('Hermes generated config/env', () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = tmp('eve-hermes-home-');
    cwd = tmp('eve-hermes-cwd-');
    osMock.home = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('writes current Hermes model config without api_server YAML', async () => {
    const { writeHermesConfigYamlSync } = await import('../src/builder-hub-wiring.js');
    const secrets = {
      version: '1',
      updatedAt: new Date().toISOString(),
      synap: { apiUrl: 'https://pod.example.com', apiKey: 'legacy-key' },
      agents: {
        hermes: { hubApiKey: 'hub-hermes-key', agentUserId: 'user-1', workspaceId: 'ws-1' },
      },
      ai: { serviceModels: { hermes: 'synap/fast' } },
      builder: { hermes: { apiServerKey: 'gateway-key' } },
    } satisfies EveSecrets;

    const configPath = writeHermesConfigYamlSync(secrets);
    const config = yaml.load(readFileSync(configPath, 'utf-8')) as HermesYaml;

    expect(config.memory).toEqual({ provider: 'synap' });
    expect(config.model).toEqual({
      provider: 'custom',
      default: 'synap/fast',
      base_url: 'https://pod.example.com/v1',
      api_key: 'hub-hermes-key',
    });
    expect(config.api_server).toBeUndefined();
  });

  it('defaults Hermes model to synap/balanced', async () => {
    const { writeHermesConfigYamlSync } = await import('../src/builder-hub-wiring.js');
    const configPath = writeHermesConfigYamlSync({
      version: '1',
      updatedAt: new Date().toISOString(),
      synap: { apiUrl: 'http://localhost:4000', apiKey: 'legacy-key' },
    });
    const config = yaml.load(readFileSync(configPath, 'utf-8')) as HermesYaml;

    expect(config.model?.default).toBe('synap/balanced');
  });

  it('writes API server settings to hermes.env including host binding', async () => {
    const { writeEveSecrets } = await import('../src/secrets-contract.js');
    const { writeHermesEnvFile } = await import('../src/builder-hub-wiring.js');
    await writeEveSecrets({
      synap: { apiUrl: 'https://pod.example.com' },
      agents: {
        hermes: { hubApiKey: 'hub-hermes-key', agentUserId: 'user-1', workspaceId: 'ws-1' },
      },
      builder: { hermes: { apiServerKey: 'gateway-key' } },
    }, cwd);

    const envPath = await writeHermesEnvFile(cwd);
    const env = readFileSync(envPath, 'utf-8');

    expect(envPath).toBe(join(home, '.eve', 'hermes.env'));
    expect(env).toContain('API_SERVER_ENABLED=true\n');
    expect(env).toContain('API_SERVER_HOST=0.0.0.0\n');
    expect(env).toContain('API_SERVER_PORT=8642\n');
    expect(env).toContain('API_SERVER_KEY=gateway-key\n');
  });
});
