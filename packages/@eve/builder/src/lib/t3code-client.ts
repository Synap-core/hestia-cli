import { WebSocket } from 'ws';

export interface T3CodeTurnResult {
  resumeCursor: string;
  output: Array<{ type?: string; text?: string; content?: string; [key: string]: unknown }>;
  sessionId: string;
}

export interface T3CodeClientConfig {
  /** WebSocket URL of the T3 Code server, e.g. ws://localhost:5004 */
  url: string;
  apiKey?: string;
  /** Timeout for initial connection + session start (ms). Default: 15s */
  connectTimeoutMs?: number;
  /** Default per-turn timeout. Default: 45min */
  turnTimeoutMs?: number;
}

/**
 * Thin WebSocket client for T3 Code (https://pingdotgg-t3code.mintlify.app).
 *
 * Protocol: JSON-RPC 2.0 over WebSocket.
 * Each runTurn call opens one connection, starts a Codex session,
 * sends the turn, awaits the turn/completed push event, then closes.
 * The returned resumeCursor must be persisted to continue the same session.
 */
export class T3CodeClient {
  constructor(private readonly config: T3CodeClientConfig) {}

  async runTurn(params: {
    cwd: string;
    messages: Array<{ role: 'user'; content: string }>;
    resumeCursor?: string;
    timeoutMs?: number;
    onProgress?: (delta: unknown) => void;
  }): Promise<T3CodeTurnResult> {
    const turnTimeout = params.timeoutMs ?? this.config.turnTimeoutMs ?? 45 * 60_000;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.url, {
        headers: this.config.apiKey
          ? { Authorization: `Bearer ${this.config.apiKey}` }
          : {},
      });

      let sessionId: string | null = null;
      let msgId = 0;
      const nextId = () => ++msgId;
      let turnSent = false;
      let settled = false;

      const timeoutHandle = setTimeout(() => {
        finish(new Error(`T3Code turn timed out after ${Math.round(turnTimeout / 60_000)}min`));
      }, turnTimeout);

      const finish = (result: T3CodeTurnResult | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        try { ws.close(1000); } catch {}
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      const send = (payload: object) => {
        ws.send(JSON.stringify({ jsonrpc: '2.0', ...payload }));
      };

      ws.on('open', () => {
        send({
          id: nextId(),
          method: 'orchestration.dispatchCommand',
          params: {
            command: 'providers.startSession',
            params: { providerId: 'codex', runtimeMode: 'full-access', cwd: params.cwd },
          },
        });
      });

      ws.on('message', (data: Buffer) => {
        let msg: {
          id?: number;
          result?: unknown;
          error?: { message: string };
          method?: string;
          params?: unknown;
        };
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        // Response to startSession (first id-keyed response before turn is sent)
        if (!turnSent && msg.id !== undefined) {
          if (msg.error) {
            finish(new Error(`T3Code startSession error: ${msg.error.message}`));
            return;
          }
          const r = msg.result as { sessionId?: string } | undefined;
          if (r?.sessionId) {
            sessionId = r.sessionId;
            turnSent = true;
            send({
              id: nextId(),
              method: 'orchestration.dispatchCommand',
              params: {
                command: 'providers.sendTurn',
                params: {
                  sessionId,
                  messages: params.messages,
                  ...(params.resumeCursor ? { resumeCursor: params.resumeCursor } : {}),
                },
              },
            });
          }
          return;
        }

        // Push: progress / streaming delta events
        if (msg.method && (msg.method.includes('delta') || msg.method.includes('progress'))) {
          params.onProgress?.(msg.params);
          return;
        }

        // Push: turn completed
        if (msg.method === 'turn/completed' || msg.method === 'session.turn.complete') {
          const p = msg.params as { resumeCursor: string; output?: unknown[]; sessionId?: string };
          finish({
            resumeCursor: p.resumeCursor,
            output: (p.output ?? []) as T3CodeTurnResult['output'],
            sessionId: p.sessionId ?? sessionId ?? '',
          });
          return;
        }

        // Error response from sendTurn
        if (msg.error && turnSent) {
          finish(new Error(`T3Code sendTurn error: ${msg.error.message}`));
        }
      });

      ws.on('error', (err) => finish(err));

      ws.on('close', (code) => {
        if (!settled && code !== 1000) {
          finish(new Error(`T3Code WebSocket closed unexpectedly (code ${code})`));
        }
      });
    });
  }
}
