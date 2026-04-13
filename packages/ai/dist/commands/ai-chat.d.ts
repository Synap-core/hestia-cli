#!/usr/bin/env node
/**
 * AI Chat Command - Manage AI chat UI interfaces for Hestia
 *
 * Provides commands for installing, configuring, and managing
 * optional AI chat UIs that connect to Hestia's AI backend.
 *
 * Commands:
 *   hestia ai:chat              - List available chat UIs
 *   hestia ai:chat:list         - Show installed and their status
 *   hestia ai:chat:install      - Install specific UI
 *   hestia ai:chat:remove       - Remove UI
 *   hestia ai:chat:start        - Start UI
 *   hestia ai:chat:stop         - Stop UI
 *   hestia ai:chat:open         - Open browser to UI
 *   hestia ai:chat:config       - Configure UI settings
 *   hestia ai:chat:logs         - Show logs
 *
 * Providers:
 *   - lobechat: Modern UI with plugin ecosystem
 *   - openwebui: Native Ollama integration
 *   - librechat: ChatGPT clone with multi-model support
 */
import { Command } from "commander";
/**
 * AI Chat command registration
 */
export declare function aiChatCommand(program: Command): void;
//# sourceMappingURL=ai-chat.d.ts.map