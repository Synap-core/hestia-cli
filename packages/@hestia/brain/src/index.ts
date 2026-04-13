// Services
export { SynapService, type SynapHealth } from './lib/synap.js';
export { OllamaService, type AIModelStatus } from './lib/ollama.js';
export { PostgresService } from './lib/postgres.js';
export { RedisService } from './lib/redis.js';

// Commands
export { initCommand } from './commands/init.js';
export { statusCommand } from './commands/status.js';
