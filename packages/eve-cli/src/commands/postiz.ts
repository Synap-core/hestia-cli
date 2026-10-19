/**
 * `eve postiz connect` — register the self-hosted Postiz with the pod, so its
 * agents can draft and schedule posts through the `postiz` capability.
 *
 * Why this is a separate step from `eve add postiz`: a Postiz API key exists
 * only once the owner has created an account in the Postiz UI and opened
 * Settings → Public API. There is no headless path to it, so the install ends
 * by telling the user to do that and run this.
 *
 * What it does: `POST /api/hub/capabilities/apply` with the `postiz` template
 * (resolved by the pod from the Control Plane catalog) and two params —
 *   postizApiKey  = the key the owner copied
 *   postizBaseUrl = the IN-NETWORK origin (`http://eve-arms-postiz:5000/api`),
 *                   which the pod backend reaches by container name over
 *                   eve-network. The pod's SSRF guard blocks private IP
 *                   literals and a fixed list of internal names; this
 *                   container name is on neither, so it is allowed.
 * The apply is governed like any other: it may come back as proposals to
 * approve in Synap.
 *
 * The key is never printed. It is kept in ~/.eve secrets (`postiz.apiKey`,
 * 0600) only after the pod accepted it, so re-running `eve postiz connect`
 * with no key (after a pod rebuild, say) re-applies the stored one.
 *
 * Then the way back: Postiz tells the pod when a post goes out through a
 * webhook. Its public API cannot create one, so connect asks the pod for the
 * URL (`POST /api/hub/tools/:id/webhook` — the same URL on every run) and
 * prints it with the one step to do in Postiz. Postiz only calls a public
 * https address (its SSRF guard), so a pod URL that resolves to a private
 * address is flagged.
 */

import type { Command } from 'commander';
import { getGlobalCliFlags } from '@eve/cli-kit';
import {
  entityStateManager,
  publicComponentUrl,
  readEveSecrets,
  writeEveSecrets,
} from '@eve/dna';
import {
  colors,
  createSpinner,
  printError,
  printHeader,
  printInfo,
  printSuccess,
  printWarning,
} from '../lib/ui.js';
import {
  postApply,
  postToolWebhook,
  resolvePodConnection,
  type ApplyCapabilityResponse,
  type PodConnection,
  type ToolWebhookResponse,
} from './capabilities.js';

/**
 * Read one line from the TTY without echoing it.
 *
 * `node:readline` rather than `@clack`: clack's prompts were measured never to
 * resolve on the pod (see `promptLine` in add.ts). Echo is suppressed by
 * routing readline's output through a muted stream.
 */
async function promptHidden(question: string): Promise<string> {
  const readline = await import('node:readline');
  const { Writable } = await import('node:stream');
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stderr.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  try {
    process.stderr.write(`${question} `);
    muted = true;
    return await new Promise<string>((resolve) => rl.question('', resolve));
  } finally {
    rl.close();
    process.stderr.write('\n');
  }
}

type KeyCheck = { verdict: 'accepted' | 'rejected' | 'unknown'; detail: string };

/**
 * Ask Postiz itself whether the key works, through its public URL, before
 * handing it to the pod. Only a 401/403 is a verdict: any other failure (no
 * hairpin route from this host, a 404 from a different API layout) is
 * "could not check", and connect continues — the pod's own call is the real
 * test.
 */
async function checkPostizKey(publicUrl: string, apiKey: string): Promise<KeyCheck> {
  try {
    const res = await fetch(`${publicUrl}/api/public/v1/integrations`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      return { verdict: 'rejected', detail: `HTTP ${res.status}` };
    }
    if (res.ok) return { verdict: 'accepted', detail: `HTTP ${res.status}` };
    return { verdict: 'unknown', detail: `HTTP ${res.status}` };
  } catch (err) {
    return { verdict: 'unknown', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The ranges Postiz refuses to call (gitroomhq/postiz-app
 * libraries/nestjs-libraries/src/dtos/webhooks/webhook.url.validator.ts).
 */
function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const v4 = mapped ? mapped[1]! : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === '::1' ||
    v6 === '::' ||
    v6.startsWith('fe80:') ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('ff')
  );
}

type LookupAll = (host: string) => Promise<string[]>;

const lookupAll: LookupAll = async (host) => {
  const { lookup } = await import('node:dns/promises');
  return (await lookup(host, { all: true })).map((r) => r.address);
};

/**
 * Why Postiz will refuse to call this URL, or null when it looks public. Same
 * rule as Postiz: https only, no localhost, no address in a private or
 * reserved range after DNS.
 */
export async function postizUnreachableReason(
  url: string,
  lookup: LookupAll = lookupAll,
): Promise<string | null> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return 'it is not https';
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost') return `${host} is this machine`;
  let addresses: string[];
  try {
    addresses = /^[\d.]+$|:/.test(host) ? [host] : await lookup(host);
  } catch (err) {
    return `${host} does not resolve (${err instanceof Error ? err.message : String(err)})`;
  }
  const blocked = addresses.find(isPrivateAddress);
  return blocked ? `${host} resolves to the private address ${blocked}` : null;
}

export type PostizWebhookOutcome =
  /** The URL to paste in Postiz. */
  | { kind: 'ready'; webhook: ToolWebhookResponse; unreachable: string | null }
  /** The postiz tool waits on a proposal; it has no id to hang a URL on yet. */
  | { kind: 'pending' };

/**
 * After the apply: ask the pod for the postiz tool's webhook URL. Throws when
 * the apply named no postiz tool or the pod refused — never guesses a URL.
 */
export async function connectPostizWebhook(
  conn: PodConnection,
  applied: ApplyCapabilityResponse,
  lookup: LookupAll = lookupAll,
): Promise<PostizWebhookOutcome> {
  const tool = applied.created.tools.find((t) => t.name === 'postiz');
  if (!tool) throw new Error('The pod applied the capability but reported no postiz tool.');
  if (typeof tool.toolId !== 'string' || !tool.toolId) return { kind: 'pending' };
  const webhook = await postToolWebhook(conn, tool.toolId);
  return { kind: 'ready', webhook, unreachable: await postizUnreachableReason(webhook.url, lookup) };
}

interface ConnectOptions {
  apiKey?: string;
  agent?: string;
}

async function runConnect(opts: ConnectOptions): Promise<void> {
  console.log();
  printHeader('Eve — Connect Postiz to your pod', '📣');
  console.log();

  if (!(await entityStateManager.isComponentInstalled('postiz'))) {
    printError('Postiz is not installed on this server.');
    printInfo('  Install it first: eve add postiz');
    process.exitCode = 1;
    return;
  }

  const secrets = await readEveSecrets(process.cwd()).catch(() => null);
  const publicUrl = publicComponentUrl('postiz', secrets?.domain?.primary, secrets?.domain?.ssl ?? false);

  let apiKey = (opts.apiKey ?? process.env.POSTIZ_API_KEY ?? secrets?.postiz?.apiKey ?? '').trim();
  if (!apiKey) {
    if (getGlobalCliFlags().nonInteractive || !process.stdin.isTTY) {
      printError('No Postiz API key given.');
      printInfo('  Pass --api-key <key>, or set POSTIZ_API_KEY.');
      process.exitCode = 1;
      return;
    }
    printInfo(`Create the key in Postiz${publicUrl ? ` (${publicUrl})` : ''}: Settings → Public API.`);
    apiKey = (await promptHidden('Paste the Postiz API key:')).trim();
    if (!apiKey) {
      printWarning('No key entered — nothing changed.');
      return;
    }
  }

  if (publicUrl) {
    const check = await checkPostizKey(publicUrl, apiKey);
    if (check.verdict === 'rejected') {
      printError(`Postiz rejected this API key (${check.detail}). Nothing was sent to the pod.`);
      printInfo('  Copy the key again from Settings → Public API.');
      process.exitCode = 1;
      return;
    }
    if (check.verdict === 'unknown') {
      printWarning(`Could not check the key against ${publicUrl} (${check.detail}) — continuing.`);
    } else {
      printInfo('Postiz accepted the key.');
    }
  }

  const agentType = opts.agent ?? 'eve';
  const conn = await resolvePodConnection(agentType);
  if (!conn) {
    printError('Could not resolve a pod URL + Hub API key.');
    printInfo('  Fix: run `eve auth provision` (mints the agent key), or set domain.primary in secrets.json.');
    process.exitCode = 1;
    return;
  }

  const { postizInternalApiUrl } = await import('@eve/lifecycle');
  const baseUrl = postizInternalApiUrl();

  const spinner = createSpinner('Registering the postiz capability with the pod…');
  spinner.start();
  let result;
  try {
    result = await postApply(conn, {
      templateKey: 'postiz',
      params: { postizApiKey: apiKey, postizBaseUrl: baseUrl },
    });
  } catch (err) {
    spinner.fail('The pod did not accept the postiz capability');
    printError(err instanceof Error ? err.message : String(err));
    printInfo('  • Hub key lacks hub-protocol.write scope → `eve auth renew --agent ' + agentType + '`');
    printInfo('  • Template "postiz" not found → the pod cannot reach the Control Plane catalog');
    printInfo('  • Backend unreachable → `eve doctor`');
    process.exitCode = 1;
    return;
  }
  spinner.succeed('Postiz connected');

  await writeEveSecrets({ postiz: { apiKey } }, process.cwd());

  console.log();
  printSuccess(`Pod: ${colors.info(conn.synapUrl)} → Postiz at ${colors.info(baseUrl)}`);
  if (result.proposals.length > 0) {
    printInfo(`  ${result.proposals.length} proposal(s) to approve in Synap before agents can post.`);
  } else {
    printInfo('  Applied directly — agents can draft and schedule posts now. You approve every send.');
  }
  console.log();

  let outcome: PostizWebhookOutcome;
  try {
    outcome = await connectPostizWebhook(conn, result);
  } catch (err) {
    printError(`The pod did not give a webhook URL: ${err instanceof Error ? err.message : String(err)}`);
    printInfo('  Without it Synap does not hear when Postiz publishes a post. Run `eve postiz connect` again.');
    process.exitCode = 1;
    return;
  }
  if (outcome.kind === 'pending') {
    printInfo('Approve the proposals in Synap, then run `eve postiz connect` again for the webhook URL.');
    console.log();
    return;
  }
  printInfo('One step left in Postiz, so Synap marks a post Published when it goes out:');
  printInfo(`  ${outcome.webhook.setupStep ?? 'Add this URL as a webhook in Postiz.'}`);
  console.log(`    ${colors.info(outcome.webhook.url)}`);
  printInfo('  Keep this URL private, like a password. Running connect again shows the same URL.');
  if (outcome.unreachable) {
    printWarning(`Postiz will refuse this URL: ${outcome.unreachable}.`);
    printInfo('  Postiz only calls public https addresses. Give the pod a public domain (PUBLIC_URL).');
  }
  console.log();
}

export function postizCommand(program: Command): void {
  const postiz = program
    .command('postiz')
    .description('📣 Postiz (self-hosted social scheduler) — connect it to your pod');

  postiz
    .command('connect')
    .description(
      'Register Postiz with the pod (the postiz capability) using an API key from ' +
        'Postiz Settings → Public API. Asks for the key when none is given; never prints it.',
    )
    .option('--api-key <key>', 'Postiz API key (or set POSTIZ_API_KEY; a flag lands in shell history)')
    .option('--agent <slug>', 'Hub identity to act as', 'eve')
    .action(async (opts: ConnectOptions) => {
      await runConnect(opts);
    });
}
