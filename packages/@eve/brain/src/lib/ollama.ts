import { execa } from './exec.js';


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
  private containerName = 'eve-brain-ollama';
  private image = 'ollama/ollama:latest';

  async install(): Promise<void> {
    console.log('Installing Ollama...');
    
    await execa('docker', ['pull', this.image], { stdio: 'inherit' });
    
    console.log('Ollama image pulled successfully');
  }

  /**
   * @param publishToHost - When false, Ollama is only on `eve-network` (use with Traefik gateway on Full stack).
   */
  async start(options?: { publishToHost?: boolean }): Promise<void> {
    const publishToHost = options?.publishToHost !== false;

    const running = await this.isRunning();
    if (running) {
      console.log('Ollama is already running');
      return;
    }

    const exists = await this.containerExists();
    if (exists) {
      await execa('docker', ['start', this.containerName], { stdio: 'inherit' });
    } else {
      const args = [
        'run',
        '-d',
        '--name',
        this.containerName,
        '--network',
        'eve-network',
        '-v',
        'ollama-models:/root/.ollama',
        '--restart',
        'unless-stopped',
      ];
      if (publishToHost) {
        args.push('-p', '127.0.0.1:11434:11434');
      }
      args.push(this.image);
      await execa('docker', args, { stdio: 'inherit' });
    }

    console.log(
      publishToHost
        ? 'Ollama started on http://127.0.0.1:11434'
        : 'Ollama started (no host port; reachable on eve-network as eve-brain-ollama:11434)',
    );
  }

  async pullModel(model: string, startOpts?: { publishToHost?: boolean }): Promise<void> {
    console.log(`Pulling model: ${model}...`);

    await this.start(startOpts);
    
    // Wait a moment for container to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await execa('docker', [
      'exec',
      this.containerName,
      'ollama',
      'pull',
      model
    ], { stdio: 'inherit' });
    
    console.log(`Model ${model} pulled successfully`);
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
