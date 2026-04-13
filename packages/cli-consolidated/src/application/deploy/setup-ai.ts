/**
 * Setup AI Use Case
 * 
 * Configures AI providers (OpenCode, OpenClaude) and syncs
 * with Synap backend.
 * 
 * Pure business logic - no UI dependencies.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProgressReporter, OperationResult } from '../types.js';

export type AIProvider = 'opencode' | 'openclaude' | 'both';
export type DeployProfile = 'minimal' | 'full' | 'ai-heavy';

export interface SetupAIInput {
  /** Deployment directory */
  deployDir: string;
  /** Domain name */
  domain: string;
  /** AI provider to set up */
  provider: AIProvider;
  /** Deployment profile */
  profile: DeployProfile;
  /** API key for Synap (optional) */
  synapApiKey?: string;
  /** AI model to use (optional) */
  aiModel?: string;
}

export interface SetupAIOutput {
  providersConfigured: string[];
  servicesStarted: string[];
  configFilesCreated: string[];
}

/**
 * Setup AI providers
 * 
 * @param input - Setup options
 * @param progress - Progress reporter
 * @returns Setup result
 */
export async function setupAI(
  input: SetupAIInput,
  progress: ProgressReporter
): Promise<OperationResult<SetupAIOutput>> {
  const { deployDir, domain, provider, profile, synapApiKey, aiModel } = input;
  
  progress.report('Setting up AI providers...');
  progress.onProgress(0);

  const result: SetupAIOutput = {
    providersConfigured: [],
    servicesStarted: [],
    configFilesCreated: [],
  };

  try {
    // Setup OpenCode
    if (provider === 'opencode' || provider === 'both') {
      progress.report('Configuring OpenCode...');
      progress.onProgress(25);

      const openCodeResult = await setupOpenCode({
        deployDir,
        domain,
        synapApiKey,
      });

      if (!openCodeResult.success) {
        return {
          success: false,
          error: `OpenCode setup failed: ${openCodeResult.error}`,
        };
      }

      result.providersConfigured.push('opencode');
      result.servicesStarted.push(...(openCodeResult.servicesStarted || []));
      result.configFilesCreated.push(...(openCodeResult.configFilesCreated || []));
    }

    // Setup OpenClaude
    if (provider === 'openclaude' || provider === 'both') {
      progress.report('Configuring OpenClaude...');
      progress.onProgress(50);

      const openClaudeResult = await setupOpenClaude({
        deployDir,
        domain,
        synapApiKey,
        aiModel,
      });

      if (!openClaudeResult.success) {
        return {
          success: false,
          error: `OpenClaude setup failed: ${openClaudeResult.error}`,
        };
      }

      result.providersConfigured.push('openclaude');
      result.configFilesCreated.push(...(openClaudeResult.configFilesCreated || []));
    }

    // Setup Ollama for AI-heavy profile
    if (profile === 'ai-heavy') {
      progress.report('Configuring Ollama (local AI)...');
      progress.onProgress(75);

      const ollamaResult = await setupOllama({
        deployDir,
        domain,
      });

      if (!ollamaResult.success) {
        // Non-fatal error for Ollama
        progress.report(`Ollama setup warning: ${ollamaResult.error}`);
      } else {
        result.providersConfigured.push('ollama');
      }
    }

    // Create AI configuration summary
    progress.report('Creating AI configuration summary...');
    const summaryContent = generateAISummary({
      domain,
      providers: result.providersConfigured,
    });
    
    const summaryPath = path.join(deployDir, 'AI-CONFIG.md');
    await fs.writeFile(summaryPath, summaryContent);
    result.configFilesCreated.push('AI-CONFIG.md');

    progress.onProgress(100);
    progress.report('AI setup complete');

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'AI setup failed',
    };
  }
}

/**
 * Setup OpenCode
 */
async function setupOpenCode(config: {
  deployDir: string;
  domain: string;
  synapApiKey?: string;
}): Promise<{ success: boolean; error?: string; servicesStarted?: string[]; configFilesCreated?: string[] }> {
  const { deployDir, domain, synapApiKey } = config;
  const result = {
    servicesStarted: [] as string[],
    configFilesCreated: [] as string[],
  };

  try {
    // Start OpenCode service
    await runDockerCompose(deployDir, ['--profile', 'opencode', 'up', '-d']);
    result.servicesStarted.push('opencode');

    // Create OpenCode config file
    const openCodeConfig = {
      version: '1.0',
      synap: {
        url: `https://${domain}`,
        apiKey: synapApiKey || 'placeholder',
      },
      workspace: {
        autoSync: true,
      },
    };

    const configPath = path.join(deployDir, 'opencode.json');
    await fs.writeFile(configPath, JSON.stringify(openCodeConfig, null, 2));
    result.configFilesCreated.push('opencode.json');

    return { success: true, ...result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Setup OpenClaude
 */
async function setupOpenClaude(config: {
  deployDir: string;
  domain: string;
  synapApiKey?: string;
  aiModel?: string;
}): Promise<{ success: boolean; error?: string; configFilesCreated?: string[] }> {
  const { deployDir, domain, synapApiKey, aiModel } = config;
  const result = {
    configFilesCreated: [] as string[],
  };

  try {
    // Create OpenClaude config file
    const openClaudeConfig = {
      version: '1.0',
      synap: {
        url: `https://${domain}`,
        apiKey: synapApiKey || 'placeholder',
        endpoint: `https://${domain}/api/hub`,
      },
      ai: {
        provider: 'openai',
        model: aiModel || 'gpt-4',
      },
      hearth: {
        name: domain,
        role: 'primary',
      },
    };

    const configPath = path.join(deployDir, 'openclaude.json');
    await fs.writeFile(configPath, JSON.stringify(openClaudeConfig, null, 2));
    result.configFilesCreated.push('openclaude.json');

    return { success: true, ...result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Setup Ollama (local AI)
 */
async function setupOllama(config: {
  deployDir: string;
  domain: string;
}): Promise<{ success: boolean; error?: string }> {
  const { deployDir } = config;

  try {
    // Start Ollama service
    await runDockerCompose(deployDir, ['--profile', 'ai', 'up', '-d']);

    // Pull default model
    await new Promise<void>((resolve, reject) => {
      const child = spawn('docker', ['exec', 'hestia-ollama', 'ollama', 'pull', 'llama2'], {
        stdio: 'ignore',
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to pull Ollama model (exit ${code})`));
        }
      });

      child.on('error', reject);
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Run docker compose command
 */
function runDockerCompose(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], {
      cwd,
      stdio: 'ignore',
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker Compose exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Generate AI configuration summary
 */
function generateAISummary(config: {
  domain: string;
  providers: string[];
}): string {
  const { domain, providers } = config;

  let content = `# Hestia AI Configuration

Generated: ${new Date().toISOString()}
Domain: ${domain}

## Configured Providers

`;

  if (providers.includes('opencode')) {
    content += `### OpenCode
- URL: https://dev.${domain}
- Status: Configured

`;
  }

  if (providers.includes('openclaude')) {
    content += `### OpenClaude
- CLI Profile: Created at openclaude.json
- Synap Endpoint: https://${domain}/api/hub
- Status: Configured

`;
  }

  if (providers.includes('ollama')) {
    content += `### Ollama (Local AI)
- URL: http://localhost:11434
- Default Model: llama2
- Status: Configured

`;
  }

  content += `## Next Steps

1. Access your AI services at the URLs above
2. Configure API keys in respective services
3. Test connectivity: hestia status

## Support

- Documentation: https://synap.dev/docs
- Issues: https://github.com/synap-dev/hestia/issues
`;

  return content;
}
