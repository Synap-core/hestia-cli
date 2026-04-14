/**
 * @eve/ai - AI/Ollama handling and routing for eve CLI
 */

export * from './lib/ai-chat-service.js';
export * from './lib/openclaude-service.js';
export * from './lib/openclaw-service.js';

// Commands
export { aiCommand } from './commands/ai.js';
export { aiChatCommand } from './commands/ai-chat.js';