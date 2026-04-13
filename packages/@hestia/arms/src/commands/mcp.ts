import { Command } from 'commander';
import { openclaw, type MCPConfig } from '../lib/openclaw.js';

export function mcpCommand(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Manage MCP (Model Context Protocol) servers');

  // List MCP servers
  mcp
    .command('list')
    .description('List installed MCP servers')
    .action(async () => {
      try {
        const servers = await openclaw.listMCPServers();
        
        if (servers.length === 0) {
          console.log('No MCP servers installed');
          console.log('\nInstall one with: hestia arms mcp install <name>');
          return;
        }

        console.log('Installed MCP servers:\n');
        servers.forEach(name => {
          console.log(`  • ${name}`);
        });
      } catch (error) {
        console.error('❌ Failed to list MCP servers:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Install MCP server
  mcp
    .command('install <name>')
    .description('Install an MCP server')
    .option('-c, --command <cmd>', 'Command to run the MCP server', 'npx')
    .option('-a, --args <args>', 'Arguments (comma-separated)', '-y,@modelcontextprotocol/server-filesystem')
    .action(async (name: string, options: { command: string; args: string }) => {
      try {
        console.log(`🔌 Installing MCP server: ${name}...\n`);

        const config: MCPConfig = {
          command: options.command,
          args: options.args.split(','),
        };

        await openclaw.installMCPServer(name, config);

        console.log(`\n✅ MCP server "${name}" installed`);
        console.log('   Restart OpenClaw to apply changes:');
        console.log('   hestia arms stop && hestia arms start');
      } catch (error) {
        console.error('❌ Failed to install MCP server:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Built-in MCP server presets
  mcp
    .command('preset <name>')
    .description('Install a preset MCP server (filesystem, github, postgres, etc.)')
    .action(async (name: string) => {
      try {
        const presets: Record<string, MCPConfig> = {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user'],
          },
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
          },
          postgres: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/db'],
          },
          sqlite: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-sqlite', '/path/to/db.sqlite'],
          },
          puppeteer: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-puppeteer'],
          },
        };

        const preset = presets[name];
        if (!preset) {
          console.error(`❌ Unknown preset: ${name}`);
          console.log('\nAvailable presets:');
          Object.keys(presets).forEach(p => console.log(`  • ${p}`));
          process.exit(1);
        }

        console.log(`🔌 Installing MCP preset: ${name}...\n`);
        await openclaw.installMCPServer(name, preset);

        console.log(`\n✅ MCP preset "${name}" installed`);
        console.log('   Restart OpenClaw to apply changes');
      } catch (error) {
        console.error('❌ Failed to install MCP preset:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
