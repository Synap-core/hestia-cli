/**
 * `eve brain freellmapi-code` — show the FreeLLMAPI dashboard URL and, when one
 * is active, the first-run setup code.
 *
 * WHY THIS COMMAND EXISTS. Upstream mints the setup code at boot whenever the
 * dashboard is still unclaimed, prints it ONCE to stdout, and clears it as soon
 * as an account exists. So the code a user was shown at install time is dead
 * after any restart, and the live one is buried in `docker logs`. Telling
 * someone to "check the server logs" is a shrug; this reads them.
 *
 * A browser running ON the host never needs the code — upstream treats a
 * loopback socket as trusted. Through Traefik at `llm.<domain>`, every browser
 * is remote, which is why the code matters at all here.
 */

import type { Command } from 'commander';
import { execSync } from 'node:child_process';
import { readEveSecrets, parseFreellmapiSetupCode } from '@eve/dna';

const CONTAINER = 'eve-brain-freellmapi';

export function freellmapiCodeCommand(brain: Command): void {
  brain
    .command('freellmapi-code')
    .description('Show the FreeLLMAPI dashboard URL and its current first-run setup code')
    .action(async () => {
      const secrets = await readEveSecrets().catch(() => null);
      const domain = secrets?.domain?.primary;
      const ssl = secrets?.domain?.ssl !== false;
      const url = domain ? `${ssl ? 'https' : 'http'}://llm.${domain}` : 'http://127.0.0.1:3001';

      console.log(`Dashboard: ${url}`);

      let logs: string;
      try {
        logs = execSync(`docker logs ${CONTAINER} 2>&1`, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        // Distinguish "no code" from "could not look" — they are different
        // facts and only one of them is the user's problem to act on.
        console.error(`Could not read logs for ${CONTAINER} — is it running? (docker ps)`);
        process.exit(1);
      }

      const code = parseFreellmapiSetupCode(logs);
      if (code) {
        console.log(`First-run setup code: ${code}`);
        console.log('  Enter this when creating the first account from a device other than this host.');
        console.log('  It changes on every restart until an account exists.');
      } else {
        console.log('No setup code active — the dashboard already has an account. Sign in normally.');
        console.log(`  Forgot the password? Restarting (docker restart ${CONTAINER}) does NOT`);
        console.log('  re-issue a code once an account exists.');
      }
    });
}
