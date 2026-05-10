/**
 * Eve Dashboard — Terminal Sidecar
 *
 * Why a sidecar: the dashboard runs on Next.js App Router, which does not
 * support WebSocket upgrades inside Route Handlers without a custom server
 * (a structural change to the existing dashboard process). Rather than
 * touch that, we run a small Node sidecar on a separate port that owns ALL
 * terminal WebSocket traffic. The Next.js frontend opens a `ws://host:PORT/...`
 * connection; the sidecar verifies the same JWT cookie the API routes
 * already verify (`eve-session` signed with `secrets.dashboard.secret`),
 * spawns a pty / docker-logs process, and pipes bytes both ways.
 *
 * Routes exposed:
 *   GET  /healthz                — liveness
 *   WS   /repl?slug=<agent>      — interactive subprocess (eve | openclaw | coder)
 *   WS   /logs?slug=<agent>      — read-only log tail (hermes)
 *   WS   /recipe                 — sequential step runner (any agent)
 *
 * Auth: token comes from the `eve-session` cookie OR a `?token=` query
 * param (xterm.js can't set cookies on a cross-origin WebSocket — when the
 * dashboard is behind Traefik it usually shares an origin, but we accept
 * the explicit token form too). HMAC HS256 verified against the same
 * dashboardSecret the Next.js routes use.
 *
 * No DB, no shared state — every connection is independent.
 */

import { createServer, type IncomingMessage } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { parse as parseUrl } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { jwtVerify } from 'jose';
import {
  AGENTS,
  resolveAgent,
  readEveSecrets,
  readCodeEngine,
  readAgentKeyOrLegacySync,
  COMPONENTS,
} from '@eve/dna';
import * as pty from 'node-pty';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.EVE_TERMINAL_SIDECAR_PORT ?? '3041', 10);
const HOST = process.env.EVE_TERMINAL_SIDECAR_HOST ?? '127.0.0.1';

// Map agent slug → terminal kinds it supports. Single source of truth, mirrored
// by the frontend in `app/agents/lib/agent-terminal-map.ts`.
type TerminalKind = 'repl' | 'logs' | 'recipe';

const AGENT_KINDS: Record<string, ReadonlyArray<TerminalKind>> = {
  eve: ['repl', 'recipe'],
  openclaw: ['repl', 'recipe'],
  coder: ['repl', 'recipe'],
  hermes: ['logs', 'recipe'],
};

// ---------------------------------------------------------------------------
// Auth helper — verify the eve-session cookie (or ?token=)
// ---------------------------------------------------------------------------

interface SessionContext {
  ok: true;
}
interface SessionFailure {
  ok: false;
  reason: string;
}

async function verifySession(req: IncomingMessage): Promise<SessionContext | SessionFailure> {
  const secrets = await readEveSecrets();
  const dashboardSecret = secrets?.dashboard?.secret;
  if (!dashboardSecret) {
    return { ok: false, reason: 'dashboard secret not configured' };
  }

  const cookieHeader = req.headers.cookie ?? '';
  const cookieToken = parseCookie(cookieHeader, 'eve-session');
  const url = parseUrl(req.url ?? '', true);
  const queryToken = typeof url.query.token === 'string' ? url.query.token : null;
  const token = cookieToken ?? queryToken;
  if (!token) return { ok: false, reason: 'no auth token' };

  try {
    const key = new TextEncoder().encode(dashboardSecret);
    await jwtVerify(token, key);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'invalid or expired token' };
  }
}

function parseCookie(header: string, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP — healthz only
// ---------------------------------------------------------------------------

const httpServer = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, port: PORT }));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

// ---------------------------------------------------------------------------
// WebSocket plumbing — one server, route by pathname
// ---------------------------------------------------------------------------

const wsServer = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  void verifySession(req).then((session) => {
    if (!session.ok) {
      socket.write(`HTTP/1.1 401 Unauthorized\r\n\r\n${session.reason}`);
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit('connection', ws, req);
    });
  });
});

wsServer.on('connection', (ws, req) => {
  const url = parseUrl(req.url ?? '', true);
  const pathname = url.pathname ?? '';
  const slug = typeof url.query.slug === 'string' ? url.query.slug : null;

  switch (pathname) {
    case '/repl':
      void handleRepl(ws, slug);
      break;
    case '/logs':
      void handleLogs(ws, slug);
      break;
    case '/recipe':
      handleRecipe(ws);
      break;
    default:
      sendErr(ws, `unknown route: ${pathname}`);
      ws.close(1008, 'unknown route');
  }
});

// ---------------------------------------------------------------------------
// REPL — interactive subprocess via node-pty
// ---------------------------------------------------------------------------

async function handleRepl(ws: WebSocket, slug: string | null): Promise<void> {
  if (!slug || !AGENT_KINDS[slug]?.includes('repl')) {
    sendErr(ws, `repl not supported for agent: ${slug ?? '(missing)'}`);
    ws.close(1008, 'repl not supported');
    return;
  }

  const agent = resolveAgent(slug);
  if (!agent) {
    sendErr(ws, `unknown agent: ${slug}`);
    ws.close(1008, 'unknown agent');
    return;
  }

  const spawnSpec = await resolveReplSpawn(slug);
  if (!spawnSpec) {
    sendErr(
      ws,
      `cannot spawn ${slug}: binary not found. ` +
        (slug === 'openclaw'
          ? 'OpenClaw runs in the eve-arms-openclaw container. Use the recipe runner with `docker exec` to interact, or install the openclaw CLI on the host.'
          : 'Check that the binary is on PATH.'),
    );
    ws.close(1011, 'binary missing');
    return;
  }

  let child: pty.IPty;
  try {
    child = pty.spawn(spawnSpec.command, spawnSpec.args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: spawnSpec.cwd ?? process.cwd(),
      env: { ...process.env, ...spawnSpec.env },
    });
  } catch (err) {
    sendErr(ws, `pty spawn failed: ${(err as Error).message}`);
    ws.close(1011, 'spawn failed');
    return;
  }

  sendCtl(ws, { type: 'ready', label: agent.label });

  child.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  child.onExit(({ exitCode, signal }) => {
    sendCtl(ws, { type: 'exit', exitCode, signal });
    if (ws.readyState === ws.OPEN) ws.close(1000, 'process exited');
  });

  ws.on('message', (raw) => {
    const text = raw.toString();
    // Resize messages arrive as JSON: {"type":"resize","cols":N,"rows":N}.
    // Everything else is raw stdin bytes for the pty.
    if (text.length > 0 && text[0] === '{') {
      try {
        const msg = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
        if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          child.resize(Math.max(1, msg.cols | 0), Math.max(1, msg.rows | 0));
          return;
        }
      } catch {
        // not JSON — fall through and write the bytes
      }
    }
    child.write(text);
  });

  ws.on('close', () => {
    try {
      child.kill();
    } catch {
      /* already dead */
    }
  });
}

interface ReplSpawnSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

async function resolveReplSpawn(slug: string): Promise<ReplSpawnSpec | null> {
  const secrets = await readEveSecrets();

  switch (slug) {
    case 'eve': {
      // Spawn an interactive shell with `eve` resolvable on PATH. The eve CLI
      // doesn't itself have a long-lived REPL — operators want a shell from
      // which they can run any `eve <subcommand>`. Use bash on POSIX.
      const shell = process.env.SHELL ?? '/bin/bash';
      return {
        command: shell,
        args: ['-l'],
        env: { TERM: 'xterm-256color' },
      };
    }
    case 'coder': {
      const engine = readCodeEngine(secrets ?? null);
      const command = engine === 'claudecode' ? 'claude' : engine;
      const hubKey = readAgentKeyOrLegacySync('coder', secrets ?? null);
      return {
        command,
        args: [],
        env: {
          TERM: 'xterm-256color',
          ...(hubKey ? { HUB_API_KEY: hubKey, SYNAP_API_KEY: hubKey } : {}),
        },
      };
    }
    case 'openclaw': {
      // Try the host-installed `openclaw` binary first. If absent on the
      // host, the operator should use Recipe Runner with `docker exec` to
      // interact with the containerised OpenClaw — handled in the UI.
      return {
        command: 'openclaw',
        args: [],
        env: { TERM: 'xterm-256color' },
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Log tail — `docker logs -f <container>` (read-only)
// ---------------------------------------------------------------------------

async function handleLogs(ws: WebSocket, slug: string | null): Promise<void> {
  if (!slug || !AGENT_KINDS[slug]?.includes('logs')) {
    sendErr(ws, `logs not supported for agent: ${slug ?? '(missing)'}`);
    ws.close(1008, 'logs not supported');
    return;
  }

  const containerName = resolveContainerName(slug);
  if (!containerName) {
    sendErr(ws, `no container known for agent: ${slug}`);
    ws.close(1011, 'no container');
    return;
  }

  // `docker logs -f --tail 200 <name>` — show recent context, then stream.
  const child: ChildProcess = spawn(
    'docker',
    ['logs', '-f', '--tail', '200', containerName],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  sendCtl(ws, { type: 'ready', label: `logs: ${containerName}` });

  child.stdout?.on('data', (b: Buffer) => {
    if (ws.readyState === ws.OPEN) ws.send(b.toString('utf-8'));
  });
  child.stderr?.on('data', (b: Buffer) => {
    if (ws.readyState === ws.OPEN) ws.send(b.toString('utf-8'));
  });
  child.on('error', (err) => {
    sendErr(ws, `docker logs failed: ${err.message}`);
    if (ws.readyState === ws.OPEN) ws.close(1011, 'logs error');
  });
  child.on('exit', (code) => {
    sendCtl(ws, { type: 'exit', exitCode: code ?? null, signal: null });
    if (ws.readyState === ws.OPEN) ws.close(1000, 'logs exited');
  });

  // Read-only: ignore any inbound messages other than ping/pong handshake.
  ws.on('close', () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already dead */
    }
  });
}

function resolveContainerName(slug: string): string | null {
  // Some agent slugs are also component ids (hermes when present).
  // Look up via COMPONENTS first; fall back to known mapping.
  const comp = COMPONENTS.find((c) => c.id === slug);
  if (comp?.service?.containerName) return comp.service.containerName;
  // Hermes runs as a CLI helper without a dedicated container in the
  // current dist; if it's not in COMPONENTS we return null and the UI
  // surfaces the file-tail/process-tail hint.
  return null;
}

// ---------------------------------------------------------------------------
// Recipe runner — sequential step runner over WS
// ---------------------------------------------------------------------------

interface RecipeStep {
  command: string;
  args: string[];
  cwd?: string;
}

interface RecipeRequest {
  type: 'run';
  steps: RecipeStep[];
}

function handleRecipe(ws: WebSocket): void {
  let running = false;
  let current: ChildProcess | null = null;

  sendCtl(ws, { type: 'ready', label: 'recipe' });

  ws.on('message', (raw) => {
    const text = raw.toString();
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      sendErr(ws, 'recipe: payload must be JSON');
      return;
    }

    const m = msg as { type?: string; steps?: unknown };
    if (m.type === 'cancel') {
      if (current) {
        try {
          current.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (m.type !== 'run' || !Array.isArray(m.steps)) {
      sendErr(ws, 'recipe: expected { type: "run", steps: [...] }');
      return;
    }

    if (running) {
      sendErr(ws, 'recipe: a run is already in progress');
      return;
    }

    const steps = (m.steps as unknown[]).filter((s): s is RecipeStep => {
      return (
        typeof s === 'object' &&
        s !== null &&
        typeof (s as RecipeStep).command === 'string' &&
        Array.isArray((s as RecipeStep).args)
      );
    });

    if (steps.length === 0) {
      sendErr(ws, 'recipe: no valid steps');
      return;
    }

    running = true;
    void runSteps(steps, ws, (proc) => {
      current = proc;
    }).finally(() => {
      running = false;
      current = null;
    });
  });

  ws.on('close', () => {
    if (current) {
      try {
        current.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  });
}

async function runSteps(
  steps: RecipeStep[],
  ws: WebSocket,
  setCurrent: (p: ChildProcess | null) => void,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    sendCtl(ws, {
      type: 'step-start',
      index: i,
      total: steps.length,
      command: step.command,
      args: step.args,
      cwd: step.cwd,
    });

    const code = await new Promise<number | null>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(step.command, step.args, {
          cwd: step.cwd ?? process.cwd(),
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        });
      } catch (err) {
        sendErr(ws, `step ${i}: spawn failed — ${(err as Error).message}`);
        resolve(-1);
        return;
      }
      setCurrent(child);

      child.stdout?.on('data', (b: Buffer) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'stdout', index: i, data: b.toString('utf-8') }));
        }
      });
      child.stderr?.on('data', (b: Buffer) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'stderr', index: i, data: b.toString('utf-8') }));
        }
      });
      child.on('error', (err) => {
        sendErr(ws, `step ${i}: ${err.message}`);
        resolve(-1);
      });
      child.on('exit', (exitCode) => {
        resolve(exitCode);
      });
    });

    setCurrent(null);
    sendCtl(ws, { type: 'step-end', index: i, exitCode: code });

    if (code !== 0) {
      sendCtl(ws, { type: 'aborted', index: i, exitCode: code });
      return;
    }
  }
  sendCtl(ws, { type: 'done', total: steps.length });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CtlMessage = { type: string; [k: string]: unknown };

function sendCtl(ws: WebSocket, msg: CtlMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify({ ctl: true, ...msg }));
  } catch {
    /* ignore */
  }
}

function sendErr(ws: WebSocket, message: string): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify({ ctl: true, type: 'error', message }));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

httpServer.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[eve-terminal-sidecar] listening on ws://${HOST}:${PORT} ` +
      `(agents: ${AGENTS.map((a) => a.agentType).join(', ')})`,
  );
});

process.on('SIGINT', () => {
  httpServer.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  httpServer.close();
  process.exit(0);
});
