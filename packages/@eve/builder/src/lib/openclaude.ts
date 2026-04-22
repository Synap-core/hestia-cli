import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEveSecrets, resolveHubBaseUrl, defaultSkillsDir } from '@eve/dna';

/**
 * @deprecated OpenClaudeService is deprecated in favor of Hermes daemon polling.
 * This class is kept for backward compatibility during the migration window.
 * New code should use HermesDaemon + TaskExecutor for headless task execution.
 */
export class OpenClaudeService {
  private isInstalled = false;
  private _configured = false;
  private configPath: string | null = null;

  /**
   * @deprecated Hermes daemon handles task execution now.
   * This method only prints a deprecation warning.
   */
  async install(): Promise<void> {
    console.warn('[OpenClaude] WARNING: OpenClaudeService is deprecated. Use Hermes daemon instead.');
    console.log('OpenClaude is available via system PATH if installed separately.');
    this.isInstalled = true;
  }

  /**
   * @deprecated Hermes reads its config from .eve/hermes-state.json.
   * This method only saves a deprecation notice.
   */
  async configure(brainUrl: string): Promise<void> {
    console.warn('[OpenClaude] WARNING: OpenClaudeService is deprecated. Configure Hermes daemon instead.');

    const secrets = await readEveSecrets(process.cwd());
    const resolvedBrainUrl =
      brainUrl ||
      secrets?.builder?.openclaudeUrl ||
      secrets?.inference?.gatewayUrl ||
      secrets?.inference?.ollamaUrl ||
      'http://127.0.0.1:11434';

    console.log(`Legacy config: brain URL = ${resolvedBrainUrl}`);

    // Save minimal config for backward-compat
    const configDir = join(process.cwd(), '.eve');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const configPath = join(configDir, 'openclaude.json');
    this.configPath = configPath;
    this._configured = true;

    // Only save if config doesn't already exist (don't overwrite Hermes config)
    if (!existsSync(configPath)) {
      const legacyConfig = {
        brainUrl: resolvedBrainUrl,
        deprecated: true,
        deprecationNotice: 'Use Hermes daemon instead. See: eve builder hermes start',
        createdAt: new Date().toISOString(),
      };
      writeFileSync(configPath, JSON.stringify(legacyConfig, null, 2));
    }

    console.log('OpenClaude legacy config saved (deprecated).');
  }

  /**
   * @deprecated Hermes daemon handles lifecycle now.
   */
  async start(): Promise<void> {
    console.warn('[OpenClaude] WARNING: OpenClaudeService is deprecated. Use Hermes daemon instead.');
    if (this.configPath && existsSync(this.configPath)) {
      console.log(`Config loaded from: ${this.configPath}`);
    }
  }

  /**
   * @deprecated No-op. Use Hermes daemon + TaskExecutor.
   */
  async generateCode(prompt: string): Promise<string> {
    console.warn('[OpenClaude] WARNING: OpenClaudeService is deprecated.');
    console.log('This method is a no-op. Use Hermes daemon for task execution.');
    return `// Deprecated: Use Hermes daemon instead. Original prompt was: ${prompt}`;
  }

  getConfig(): { brainUrl?: string; deprecated?: boolean } {
    if (this.configPath && existsSync(this.configPath)) {
      return JSON.parse(readFileSync(this.configPath, 'utf-8'));
    }
    return { deprecated: true };
  }

  isConfigured(): boolean {
    return this._configured;
  }
}
