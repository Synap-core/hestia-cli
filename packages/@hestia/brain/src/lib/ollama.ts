import { execa } from 'execa';
import { logger } from '@hestia/dna';

export interface AIModelStatus {
  running: boolean;
  currentModel?: string;
  modelsInstalled: string[];
  memoryUsage?: {
    used: number;
    total: number;
  };
}

export class OllamaService {
  private containerName = 'hestia-ollama';
  private image = 'ollama/ollama:latest';

  async install(): Promise<void> {
    logger.info('Installing Ollama...');
    
    await execa('docker', ['pull', this.image], { stdio: 'inherit' });
    
    logger.success('Ollama image pulled successfully');
  }

  async start(): Promise<void> {
    const running = await this.isRunning();
    if (running) {
      logger.info('Ollama is already running');
      return;
    }

    const exists = await this.containerExists();
    if (exists) {
      await execa('docker', ['start', this.containerName], { stdio: 'inherit' });
    } else {
      await execa('docker', [
        'run',
        '-d',
        '--name', this.containerName,
        '--network', 'hestia-network',
        '-p', '11434:11434',
        '-v', 'ollama-models:/root/.ollama',
        '--restart', 'unless-stopped',
        this.image
      ], { stdio: 'inherit' });
    }

    logger.success('Ollama started on port 11434');
  }

  async pullModel(model: string): Promise<void> {
    logger.info(`Pulling model: ${model}...`);
    
    await this.start();
    
    // Wait a moment for container to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await execa('docker', [
      'exec',
      this.containerName,
      'ollama',
      'pull',
      model
    ], { stdio: 'inherit' });
    
    logger.success(`Model ${model} pulled successfully`);
  }

  async isRunning(): Promise<boolean> {
    try {
      const { stdout } = await execa('docker', [
        'ps',
        '--filter', `name=${this.containerName}`,
        '--filter', 'status=running',
        '--format', '{{.Names}}'
      ]);
      return stdout.trim() === this.containerName;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<AIModelStatus> {
    const running = await this.isRunning();
    const models = await this.listModels();
    
    return {
      running,
      modelsInstalled: models,
      currentModel: models.length > 0 ? models[0] : undefined
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const { stdout } = await execa('docker', [
        'exec',
        this.containerName,
        'ollama',
        'list'
      ]);
      
      // Parse output: NAME	ID	SIZE	MODIFIED
      const lines = stdout.trim().split('\n').slice(1);
      return lines.map(line => line.split(/\s+/)[0]).filter(Boolean);
    } catch {
      return [];
    }
  }

  private async containerExists(): Promise<boolean> {
    try {
      const { stdout } = await execa('docker', [
        'ps',
        '-a',
        '--filter', `name=${this.containerName}`,
        '--format', '{{.Names}}'
      ]);
      return stdout.trim() === this.containerName;
    } catch {
      return false;
    }
  }
}
