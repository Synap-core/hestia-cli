import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { readEveSecrets } from '@eve/dna';

interface OpenClaudeConfig {
  brainUrl: string;
  basicAuth?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
}

export class OpenClaudeService {
  private isInstalled = false;
  private config: OpenClaudeConfig | null = null;
  private configPath: string | null = null;

  async install(): Promise<void> {
    console.log('Installing OpenClaude...');
    try {
      execSync('which openclaude', { stdio: 'ignore' });
      console.log('OpenClaude already installed');
    } catch {
      console.log('Installing OpenClaude CLI...');
      execSync('npm install -g @openclaude/cli', { stdio: 'inherit' });
    }
    this.isInstalled = true;
    console.log('OpenClaude installed successfully');
  }

  async configure(brainUrl: string): Promise<void> {
    if (!this.isInstalled) {
      await this.install();
    }

    const secrets = await readEveSecrets(process.cwd());
    const resolvedBrainUrl =
      brainUrl ||
      secrets?.builder?.openclaudeUrl ||
      secrets?.inference?.gatewayUrl ||
      secrets?.inference?.ollamaUrl ||
      'http://127.0.0.1:11434';
    const basicAuth =
      secrets?.inference?.gatewayUser && secrets?.inference?.gatewayPass
        ? Buffer.from(`${secrets.inference.gatewayUser}:${secrets.inference.gatewayPass}`).toString('base64')
        : undefined;

    console.log(`Configuring OpenClaude with Brain at: ${resolvedBrainUrl}`);

    // Verify Brain Ollama connection
    try {
      const response = await fetch(`${resolvedBrainUrl}/api/tags`, {
        headers: basicAuth ? { Authorization: `Basic ${basicAuth}` } : undefined,
      });
      if (!response.ok) {
        throw new Error(`Brain Ollama not responding at ${resolvedBrainUrl}`);
      }
      const models = await response.json();
      console.log('Available models:', models.models?.map((m: { name: string }) => m.name).join(', '));
    } catch (error) {
      console.warn('Could not connect to Brain Ollama:', error);
      console.log('Configuration will be saved but may need adjustment');
    }

    this.config = {
      brainUrl: resolvedBrainUrl,
      basicAuth,
      model: 'llama3.2',
      temperature: 0.7,
      maxTokens: 2048,
      enabled: true,
    };

    // Save config
    const configDir = join(process.cwd(), '.eve');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    this.configPath = join(configDir, 'openclaude.json');
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));

    console.log('OpenClaude configuration saved');
  }

  async start(): Promise<void> {
    if (!this.config) {
      // Try to load existing config
      const configPath = join(process.cwd(), '.eve', 'openclaude.json');
      if (existsSync(configPath)) {
        this.config = JSON.parse(readFileSync(configPath, 'utf-8'));
        this.configPath = configPath;
      } else {
        throw new Error('OpenClaude not configured. Run configure() first.');
      }
    }

    console.log('Starting OpenClaude AI assistant...');
    if (this.config) {
      console.log(`Connected to Brain at: ${this.config.brainUrl}`);
    }
    console.log('OpenClaude is ready for code generation');
  }

  async generateCode(prompt: string): Promise<string> {
    if (!this.config) {
      throw new Error('OpenClaude not configured');
    }

    console.log('Generating code with OpenClaude...');
    console.log(`Prompt: ${prompt}`);

    try {
      // Call Brain Ollama for code generation
      const response = await fetch(`${this.config.brainUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.basicAuth ? { Authorization: `Basic ${this.config.basicAuth}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt: `You are an expert programmer. Generate clean, well-documented code for the following request:\n\n${prompt}\n\nProvide only the code without explanations unless specifically asked.`,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Brain Ollama error: ${response.statusText}`);
      }

      const result = await response.json();
      const generatedCode = result.response || result.text || '';

      console.log('Code generated successfully');
      return generatedCode;
    } catch (error) {
      console.error('Code generation failed:', error);
      throw error;
    }
  }

  getConfig(): OpenClaudeConfig | null {
    return this.config;
  }

  isConfigured(): boolean {
    return this.config !== null;
  }
}
