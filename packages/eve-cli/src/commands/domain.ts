import type { Command } from 'commander';
import { writeEveSecrets, readEveSecrets, getAccessUrls, getServerIp } from '@eve/dna';
import { TraefikService } from '@eve/legs';
import { colors, printSuccess, printInfo } from '../lib/ui.js';

export function domainCommand(program: Command): void {
  const domain = program
    .command('domain')
    .description('Configure domain access and Traefik routing');

  domain
    .command('set <domain>')
    .description('Set primary domain and configure Traefik subdomains')
    .option('--ssl', "Enable SSL with Let's Encrypt")
    .option('--email <email>', "Email for Let's Encrypt notifications")
    .action(async (domainName: string, opts: { ssl?: boolean; email?: string }) => {
      await writeEveSecrets({ domain: { primary: domainName, ssl: !!opts.ssl, email: opts.email } });

      try {
        const traefik = new TraefikService();
        await traefik.configureSubdomains(domainName, !!opts.ssl, opts.email);
        printSuccess(`Traefik routes configured for ${domainName}`);
      } catch {
        printInfo('Traefik config could not be written — run this command on your server to apply routes.');
      }

      const secrets = await readEveSecrets(process.cwd());
      const urls = getAccessUrls(secrets);

      console.log();
      console.log(colors.primary.bold('Access URLs:'));
      console.log(colors.muted('─'.repeat(60)));
      for (const svc of urls) {
        if (svc.domainUrl) {
          console.log(`  ${svc.emoji}  ${svc.label.padEnd(20)} ${colors.primary(svc.domainUrl)}`);
        }
      }
      const serverIp = getServerIp();
      const subdomains = ['eve', 'pod', 'openclaw', 'feeds', 'ai', 'traefik'];
      console.log();
      console.log(colors.primary.bold('DNS records to create:'));
      console.log(colors.muted('─'.repeat(60)));
      console.log(colors.muted(`  Type   Name                        Value`));
      console.log(colors.muted('─'.repeat(60)));
      for (const sub of subdomains) {
        const name = `${sub}.${domainName}`.padEnd(30);
        const value = serverIp ?? colors.warning('<your-server-ip>');
        console.log(`  ${colors.primary('A')}      ${name}  ${value}`);
      }
      console.log(colors.muted('─'.repeat(60)));
      if (!serverIp) {
        printInfo('Could not detect server IP automatically — replace <your-server-ip> above.');
      }
      if (opts.ssl) {
        console.log();
        printInfo('SSL will provision automatically once DNS records propagate (usually 1–5 min).');
      }
    });

  domain
    .command('show')
    .description('Show all access URLs (local, server IP, domain)')
    .action(async () => {
      const secrets = await readEveSecrets(process.cwd());
      const urls = getAccessUrls(secrets);
      const domainSet = !!secrets?.domain?.primary;

      console.log();
      console.log(colors.primary.bold('Eve — Access URLs'));
      console.log(colors.muted('─'.repeat(70)));

      for (const svc of urls) {
        console.log();
        console.log(`  ${svc.emoji}  ${colors.primary.bold(svc.label)}`);
        console.log(`     ${colors.muted('Local:')}    ${svc.localUrl}`);
        if (svc.serverUrl) console.log(`     ${colors.muted('Server:')}   ${svc.serverUrl}`);
        if (svc.domainUrl) console.log(`     ${colors.muted('Domain:')}   ${colors.primary(svc.domainUrl)}`);
      }

      console.log();
      if (!domainSet) {
        console.log(colors.muted("  Tip: run `eve domain set yourdomain.com --ssl` to configure domain access"));
      }
    });

  domain
    .command('unset')
    .description('Remove domain configuration')
    .action(async () => {
      const secrets = await readEveSecrets(process.cwd());
      if (secrets?.domain?.primary) {
        await writeEveSecrets({ domain: { primary: undefined, ssl: undefined, email: undefined } });
        printSuccess('Domain configuration removed');
      } else {
        printInfo('No domain configured');
      }
    });
}
