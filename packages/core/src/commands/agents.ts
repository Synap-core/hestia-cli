/**
 * agents command - Manage the A2A (Agent-to-Agent) Bridge
 * Usage: hestia agents <subcommand>
 */

import { Command } from 'commander';
import { a2aBridge, AgentStatus } from '../lib/a2a-bridge.js';
import { logger, table } from '../lib/logger.js';
import { openclaudeService } from '../lib/openclaude-service.js';
import { openclawService } from '../lib/openclaw-service.js';

interface ListOptions {
  type?: string;
  status?: string;
  json?: boolean;
}

interface SendOptions {
  to?: string;
  action?: string;
  payload?: string;
  priority?: string;
}

interface BroadcastOptions {
  action?: string;
  payload?: string;
  priority?: string;
}

export function agentsCommand(program: Command): void {
  const agentsCmd = program
    .command('agents')
    .description('Manage the A2A (Agent-to-Agent) Bridge');

  // agents:list - List all registered agents
  agentsCmd
    .command('list')
    .alias('ls')
    .description('List all registered agents')
    .option('-t, --type <type>', 'Filter by agent type (openclaude, openclaw, custom)')
    .option('-s, --status <status>', 'Filter by status (online, offline, busy, error)')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      try {
        let agents = a2aBridge.getAllAgents();

        // Apply filters
        if (options.type) {
          agents = agents.filter((a) => a.type === options.type);
        }
        if (options.status) {
          agents = agents.filter((a) => a.status === options.status);
        }

        if (options.json) {
          console.log(JSON.stringify(agents, null, 2));
          return;
        }

        // Show OpenClaude and OpenClaw status
        logger.header('AGENT SERVICES');
        const openclaudeRunning = openclaudeService.isRunning();
        const openclawRunning = await openclawService.isRunning();

        if (openclaudeRunning) {
          logger.success('OpenClaude: Running');
        } else {
          logger.error('OpenClaude: Stopped');
        }

        if (openclawRunning) {
          logger.success('OpenClaw: Running');
        } else {
          logger.error('OpenClaw: Stopped');
        }

        logger.newline();
        logger.header('REGISTERED AGENTS');

        if (agents.length === 0) {
          logger.info('No agents registered.');
          return;
        }

        const tableData = agents.map((agent) => ({
          ID: agent.id,
          NAME: agent.name,
          TYPE: agent.type,
          STATUS: formatAgentStatus(agent.status),
          CAPABILITIES: agent.capabilities.slice(0, 3).join(', ') + (agent.capabilities.length > 3 ? '...' : ''),
          HEARTBEAT: agent.lastHeartbeat ? formatTimeAgo(agent.lastHeartbeat) : 'Never',
        }));

        table(tableData);

        logger.newline();
        logger.info(`Total: ${agents.length} agent${agents.length !== 1 ? 's' : ''}`);
      } catch (error: any) {
        logger.error(`Failed to list agents: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:status - Show A2A bridge status
  agentsCmd
    .command('status')
    .description('Show A2A bridge status')
    .option('-j, --json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      try {
        const stats = a2aBridge.getStats();
        const allAgents = a2aBridge.getAllAgents();
        const memoryKeys = a2aBridge.getMemoryKeys();

        // Calculate queue size
        let totalQueued = 0;
        for (const agent of allAgents) {
          totalQueued += a2aBridge.getQueuedMessages(agent.id).length;
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                active: true,
                agents: {
                  total: stats.agents,
                  online: stats.onlineAgents,
                  offline: stats.agents - stats.onlineAgents,
                },
                queue: {
                  size: totalQueued,
                },
                memory: {
                  keys: memoryKeys.length,
                  entries: stats.memoryEntries,
                },
              },
              null,
              2
            )
          );
          return;
        }

        logger.header('A2A BRIDGE STATUS');
        logger.success('Bridge Status: Active');
        logger.newline();

        logger.section('Agents');
        logger.info(`Total Registered: ${stats.agents}`);
        logger.success(`Online: ${stats.onlineAgents}`);
        logger.info(`Offline: ${stats.agents - stats.onlineAgents}`);

        logger.newline();
        logger.section('Message Queue');
        logger.info(`Total Queued Messages: ${totalQueued}`);

        logger.newline();
        logger.section('Shared Memory');
        logger.info(`Memory Entries: ${stats.memoryEntries}`);
        logger.info(`Memory Keys: ${memoryKeys.length}`);
      } catch (error: any) {
        logger.error(`Failed to get bridge status: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:send - Send message to an agent
  agentsCmd
    .command('send')
    .description('Send message to an agent')
    .option('-t, --to <agent-id>', 'Target agent ID')
    .option('-a, --action <action>', 'Action to perform')
    .option('-p, --payload <json>', 'JSON payload')
    .option('--priority <priority>', 'Message priority (low, normal, high, critical)', 'normal')
    .action(async (options: SendOptions) => {
      try {
        // Interactive mode if options not provided
        let targetAgent = options.to;
        let action = options.action;
        let payload: unknown = {};

        if (!targetAgent || !action) {
          const readline = await import('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const ask = (prompt: string): Promise<string> => {
            return new Promise((resolve) => rl.question(prompt, resolve));
          };

          if (!targetAgent) {
            const agents = a2aBridge.getAllAgents();
            if (agents.length === 0) {
              logger.error('No agents registered. Please register an agent first.');
              rl.close();
              process.exit(1);
            }

            logger.info('Available agents:');
            agents.forEach((a) => logger.info(`  - ${a.id} (${a.name}) [${a.status}]`));
            targetAgent = await ask('Target agent ID: ');
          }

          if (!action) {
            action = await ask('Action: ');
          }

          const payloadStr = await ask('Payload (JSON, optional): ');
          if (payloadStr.trim()) {
            try {
              payload = JSON.parse(payloadStr);
            } catch {
              logger.warn('Invalid JSON payload, using empty object');
            }
          }

          rl.close();
        } else if (options.payload) {
          try {
            payload = JSON.parse(options.payload);
          } catch {
            logger.error('Invalid JSON payload');
            process.exit(1);
          }
        }

        // Validate priority
        const priority = (options.priority as 'low' | 'normal' | 'high' | 'critical') || 'normal';
        const validPriorities = ['low', 'normal', 'high', 'critical'];
        if (!validPriorities.includes(priority)) {
          logger.error(`Invalid priority: ${priority}. Must be one of: ${validPriorities.join(', ')}`);
          process.exit(1);
        }

        // Send message from CLI agent
        const cliAgentId = 'hestia-cli';

        logger.info(`Sending message to ${targetAgent}...`);

        try {
          const message = await a2aBridge.send(cliAgentId, targetAgent!, action!, payload, {
            priority,
          });

          logger.success('Message sent successfully');
          logger.info(`Message ID: ${message.id}`);
          logger.info(`Timestamp: ${message.timestamp.toISOString()}`);
        } catch (err: any) {
          if (err.code === 'AGENT_OFFLINE') {
            logger.warn(`Agent is offline - message queued for later delivery`);
            logger.info(`Message will be delivered when agent comes online`);
          } else {
            throw err;
          }
        }
      } catch (error: any) {
        logger.error(`Failed to send message: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:broadcast - Broadcast message to all agents
  agentsCmd
    .command('broadcast')
    .description('Broadcast message to all online agents')
    .option('-a, --action <action>', 'Action to perform', 'ping')
    .option('-p, --payload <json>', 'JSON payload', '{}')
    .option('--priority <priority>', 'Message priority (low, normal, high, critical)', 'normal')
    .action(async (options: BroadcastOptions) => {
      try {
        let payload: unknown = {};
        if (options.payload) {
          try {
            payload = JSON.parse(options.payload);
          } catch {
            logger.error('Invalid JSON payload');
            process.exit(1);
          }
        }

        // Validate priority
        const priority = (options.priority as 'low' | 'normal' | 'high' | 'critical') || 'normal';
        const validPriorities = ['low', 'normal', 'high', 'critical'];
        if (!validPriorities.includes(priority)) {
          logger.error(`Invalid priority: ${priority}. Must be one of: ${validPriorities.join(', ')}`);
          process.exit(1);
        }

        const cliAgentId = 'hestia-cli';
        const onlineAgents = a2aBridge.getAgentsByStatus('online').filter((a) => a.id !== cliAgentId);

        if (onlineAgents.length === 0) {
          logger.warn('No online agents to broadcast to');
          return;
        }

        logger.info(`Broadcasting to ${onlineAgents.length} online agent${onlineAgents.length !== 1 ? 's' : ''}...`);

        const results = await a2aBridge.broadcast(cliAgentId, options.action!, payload, {
          priority,
        });

        logger.success(`Broadcast sent to ${results.length} agent${results.length !== 1 ? 's' : ''}`);

        logger.newline();
        logger.section('Delivery Report');

        const tableData = results.map((msg) => ({
          AGENT: msg.to,
          ACTION: msg.action,
          STATUS: 'Delivered',
          TIME: formatTimeAgo(msg.timestamp),
        }));

        table(tableData);
      } catch (error: any) {
        logger.error(`Failed to broadcast message: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:memory - Manage shared memory
  const memoryCmd = agentsCmd.command('memory').description('Manage shared memory');

  // agents:memory:get <key>
  memoryCmd
    .command('get <key>')
    .description('Get a value from shared memory')
    .option('-j, --json', 'Output as JSON')
    .action((key: string, options: { json?: boolean }) => {
      try {
        const entry = a2aBridge.getMemoryEntry(key);

        if (!entry) {
          logger.error(`Key not found: ${key}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(entry, null, 2));
          return;
        }

        logger.header('MEMORY ENTRY');
        logger.info(`Key: ${key}`);
        logger.info(`Created: ${entry.createdAt.toISOString()}`);
        logger.info(`Updated: ${entry.updatedAt.toISOString()}`);
        if (entry.tags && entry.tags.length > 0) {
          logger.info(`Tags: ${entry.tags.join(', ')}`);
        }
        if (entry.agentId) {
          logger.info(`Agent: ${entry.agentId}`);
        }

        logger.newline();
        logger.section('Value');
        console.log(JSON.stringify(entry.value, null, 2));
      } catch (error: any) {
        logger.error(`Failed to get memory: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:memory:set <key> <value>
  memoryCmd
    .command('set <key> <value>')
    .description('Set a value in shared memory')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('-a, --agent <agent-id>', 'Associate with agent ID')
    .action((key: string, value: string, options: { tags?: string; agent?: string }) => {
      try {
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // If not valid JSON, store as string
          parsedValue = value;
        }

        const tags = options.tags?.split(',').map((t) => t.trim()).filter(Boolean);

        const entry = a2aBridge.setMemory(key, parsedValue, {
          tags,
          agentId: options.agent,
        });

        logger.success(`Memory stored: ${key}`);
        logger.info(`Updated at: ${entry.updatedAt.toISOString()}`);
      } catch (error: any) {
        logger.error(`Failed to set memory: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:memory:delete <key>
  memoryCmd
    .command('delete <key>')
    .alias('del')
    .alias('rm')
    .description('Delete a key from shared memory')
    .action((key: string) => {
      try {
        const deleted = a2aBridge.deleteMemory(key);

        if (deleted) {
          logger.success(`Memory deleted: ${key}`);
        } else {
          logger.warn(`Key not found: ${key}`);
        }
      } catch (error: any) {
        logger.error(`Failed to delete memory: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:memory:list
  memoryCmd
    .command('list')
    .alias('ls')
    .description('List all memory keys')
    .option('-j, --json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      try {
        const keys = a2aBridge.getMemoryKeys();

        if (options.json) {
          console.log(JSON.stringify(keys, null, 2));
          return;
        }

        if (keys.length === 0) {
          logger.info('No memory entries found.');
          return;
        }

        logger.header('MEMORY KEYS');
        keys.forEach((key) => logger.info(`  - ${key}`));
        logger.newline();
        logger.info(`Total: ${keys.length} key${keys.length !== 1 ? 's' : ''}`);
      } catch (error: any) {
        logger.error(`Failed to list memory: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:memory:query <query>
  memoryCmd
    .command('query <query>')
    .description('Search memory by query pattern')
    .option('-t, --tags <tags>', 'Filter by comma-separated tags')
    .option('-a, --agent <agent-id>', 'Filter by agent ID')
    .option('-l, --limit <number>', 'Limit results', '20')
    .option('-j, --json', 'Output as JSON')
    .action((query: string, options: { tags?: string; agent?: string; limit?: string; json?: boolean }) => {
      try {
        const tags = options.tags?.split(',').map((t) => t.trim()).filter(Boolean);
        const limit = parseInt(options.limit || '20', 10);

        const results = a2aBridge.queryMemory({
          keyPattern: query,
          tags,
          agentId: options.agent,
          limit,
        });

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          logger.info('No matching memory entries found.');
          return;
        }

        logger.header('MEMORY QUERY RESULTS');

        const tableData = results.map((entry) => ({
          KEY: entry.key,
          UPDATED: formatTimeAgo(entry.updatedAt),
          TAGS: entry.tags?.join(', ') || '-',
          AGENT: entry.agentId || '-',
        }));

        table(tableData);

        logger.newline();
        logger.info(`Found ${results.length} result${results.length !== 1 ? 's' : ''}`);
      } catch (error: any) {
        logger.error(`Failed to query memory: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:route - Configure agent routing
  agentsCmd
    .command('route')
    .description('Configure agent routing rules')
    .action(async () => {
      try {
        logger.header('AGENT ROUTING');

        // Show current routing info
        const agents = a2aBridge.getAllAgents();

        logger.section('Registered Agents & Capabilities');

        if (agents.length === 0) {
          logger.info('No agents registered.');
          return;
        }

        for (const agent of agents) {
          logger.info(`\n${agent.name} (${agent.id})`);
          logger.info(`  Type: ${agent.type}`);
          logger.info(`  Status: ${formatAgentStatus(agent.status)}`);
          logger.info(`  Capabilities:`);
          for (const cap of agent.capabilities) {
            logger.info(`    - ${cap}`);
          }
        }

        logger.newline();
        logger.section('Routing Logic');
        logger.info('Routing is capability-based. Messages are routed to agents');
        logger.info('that advertise matching capabilities. Use the send command');
        logger.info('with --to to target specific agents.');

        // Interactive mode to add/remove rules
        logger.newline();
        logger.info('Interactive routing configuration:');

        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const ask = (prompt: string): Promise<string> => {
          return new Promise((resolve) => rl.question(prompt, resolve));
        };

        const action = await ask('Add capability to agent? (yes/no): ');

        if (action.toLowerCase() === 'yes' || action.toLowerCase() === 'y') {
          const agentId = await ask('Agent ID: ');
          const agent = a2aBridge.getAgent(agentId);

          if (!agent) {
            logger.error(`Agent not found: ${agentId}`);
            rl.close();
            process.exit(1);
          }

          const capability = await ask('Capability to add: ');

          if (!agent.capabilities.includes(capability)) {
            agent.capabilities.push(capability);
            logger.success(`Added capability '${capability}' to ${agent.name}`);
          } else {
            logger.warn(`Agent already has capability: ${capability}`);
          }
        }

        rl.close();
      } catch (error: any) {
        logger.error(`Failed to configure routing: ${error.message}`);
        process.exit(1);
      }
    });

  // agents:heartbeat - Send manual heartbeat
  agentsCmd
    .command('heartbeat <agent-id>')
    .description('Send manual heartbeat for testing')
    .option('-m, --metadata <json>', 'Heartbeat metadata (JSON)')
    .action((agentId: string, options: { metadata?: string }) => {
      try {
        const agent = a2aBridge.getAgent(agentId);

        if (!agent) {
          logger.error(`Agent not found: ${agentId}`);
          process.exit(1);
        }

        let metadata: Record<string, unknown> | undefined;
        if (options.metadata) {
          try {
            metadata = JSON.parse(options.metadata);
          } catch {
            logger.error('Invalid JSON metadata');
            process.exit(1);
          }
        }

        logger.info(`Sending heartbeat for ${agent.name}...`);

        a2aBridge.heartbeat(agentId, metadata);

        logger.success('Heartbeat recorded');
        logger.info(`Status: ${formatAgentStatus(agent.status)}`);
        logger.info(`Last Heartbeat: ${agent.lastHeartbeat ? agent.lastHeartbeat.toISOString() : 'Never'}`);
      } catch (error: any) {
        logger.error(`Failed to send heartbeat: ${error.message}`);
        process.exit(1);
      }
    });
}

// Helper functions
function formatAgentStatus(status: AgentStatus): string {
  const statusMap: Record<AgentStatus, string> = {
    online: 'online',
    offline: 'offline',
    busy: 'busy',
    error: 'error',
  };
  return statusMap[status] || status;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
