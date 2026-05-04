import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import {
  buildExecArgs,
  FallbackRunner,
  FetchRunner,
  DockerExecRunner,
} from '../src/lib/doctor-runners.js';
import type { IDoctorRunner, DoctorRunnerResponse, DoctorRunnerStream } from '@eve/lifecycle';

describe('buildExecArgs', () => {
  it('builds a docker-exec argv that runs a Node fetch script in the container', () => {
    const built = buildExecArgs(
      'GET',
      'http://127.0.0.1:4000/api/hub/openapi.json',
      { Authorization: 'Bearer key', Accept: 'application/json' },
      undefined,
      6_000,
      'synap-backend-backend-1',
      false,
    );
    if (!built.supported) throw new Error('GET should always be supported');
    expect(built.container).toBe('synap-backend-backend-1');
    // `-i` is required so docker exec attaches stdin (the body channel).
    expect(built.argv.slice(0, 3)).toEqual(['exec', '-i', 'synap-backend-backend-1']);
    // The script is invoked via `node -e <inline>`. Six argv elements total:
    //   exec, -i, container, node, -e, <script>
    expect(built.argv[3]).toBe('node');
    expect(built.argv[4]).toBe('-e');
    expect(built.argv).toHaveLength(6);

    // Script content: must reference Node fetch with the right URL/method/headers.
    const script = built.argv[5];
    expect(script).toContain('fetch(');
    expect(script).toContain('"http://127.0.0.1:4000/api/hub/openapi.json"');
    expect(script).toContain('"GET"');
    // Headers are JSON-stringified into the script — value-includes assertion
    // is enough (we don't care about formatting).
    expect(script).toContain('"Authorization":"Bearer key"');
    expect(script).toContain('"Accept":"application/json"');
    // GET must NOT pipe stdin into the body field.
    expect(script).toContain('HAS_BODY=false');
    // Stdin is empty for GET — execa closes it immediately.
    expect(built.stdin).toBe('');
  });

  it('passes POST body via stdin so shell escaping never matters', () => {
    // Body deliberately includes characters that would need escaping in a
    // shell command line (quotes, ampersand, newline) — proving the body
    // travels via stdin, not argv.
    const trickyBody = '{"foo":"a&b","quote":"\\"x\\"","nl":"line1\\nline2"}';
    const built = buildExecArgs('POST', 'http://x/y', {}, trickyBody, 6_000, 'some-container', false);
    if (!built.supported) throw new Error('POST should be supported');
    // Body goes via stdin verbatim.
    expect(built.stdin).toBe(trickyBody);
    // Body must NOT appear anywhere in argv (the script reads it from stdin).
    expect(built.argv.some(a => a.includes('a&b'))).toBe(false);
    // Script reads stdin and gates it on HAS_BODY=true.
    expect(built.argv[5]).toContain('process.stdin');
    expect(built.argv[5]).toContain('HAS_BODY=true');
  });

  it('supports DELETE natively (Node fetch handles arbitrary methods)', () => {
    const built = buildExecArgs('DELETE', 'http://x/y', {}, undefined, 6_000, 'some-container', false);
    expect(built.supported).toBe(true);
    if (!built.supported) throw new Error('DELETE should be supported');
    expect(built.argv[5]).toContain('"DELETE"');
  });

  it('streaming mode emits a body sentinel between envelope and chunks', () => {
    const built = buildExecArgs('GET', 'http://x/y', {}, undefined, 30_000, 'c', true);
    if (!built.supported) throw new Error('GET should be supported');
    // Sentinel string must appear in the inline script — it's how the
    // host code splits envelope-from-body when reading stdout.
    expect(built.argv[5]).toContain('---SYNAP-BODY---');
    // Streaming script pipes Buffer-of-chunk to stdout, not r.text().
    expect(built.argv[5]).toContain('r.body');
    expect(built.argv[5]).toContain('getReader');
  });
});

describe('FetchRunner', () => {
  it('returns a parsed status, body, and headers from a real HTTP server', async () => {
    const server = createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Idempotent-Replay', 'true');
      res.end(JSON.stringify({ openapi: '3.1.0' }));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (typeof addr !== 'object' || !addr) throw new Error('no addr');

    try {
      const runner = new FetchRunner();
      const res = await runner.httpGet(`http://127.0.0.1:${addr.port}/foo`, {
        Authorization: 'Bearer x',
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ openapi: '3.1.0' });
      // Headers normalized to lowercase keys.
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['x-idempotent-replay']).toBe('true');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('returns status=0 + error on transport failure', async () => {
    const runner = new FetchRunner();
    // Reserved discard port — refuses every connection.
    const res = await runner.httpGet('http://127.0.0.1:1/foo', {}, { timeoutMs: 500 });
    expect(res.status).toBe(0);
    expect(res.error).toBeDefined();
  });
});

describe('FallbackRunner', () => {
  it('uses the primary runner when it succeeds', async () => {
    let primaryCalls = 0;
    let secondaryCalls = 0;
    const primary: IDoctorRunner = makeStubRunner('primary', () => {
      primaryCalls += 1;
      return { status: 200, body: 'ok', headers: {} };
    });
    const secondary: IDoctorRunner = makeStubRunner('secondary', () => {
      secondaryCalls += 1;
      return { status: 200, body: 'second', headers: {} };
    });

    const fallback = new FallbackRunner(primary, secondary);
    const res = await fallback.httpGet('http://x/y', {});
    expect(res.body).toBe('ok');
    expect(primaryCalls).toBe(1);
    expect(secondaryCalls).toBe(0);
  });

  it('swaps to secondary on ECONNREFUSED and stays swapped', async () => {
    let primaryCalls = 0;
    let secondaryCalls = 0;
    const swapNotes: string[] = [];

    const primary: IDoctorRunner = makeStubRunner('primary', () => {
      primaryCalls += 1;
      return { status: 0, body: '', headers: {}, error: 'fetch failed: ECONNREFUSED' };
    });
    const secondary: IDoctorRunner = makeStubRunner('secondary', () => {
      secondaryCalls += 1;
      return { status: 200, body: 'rescued', headers: {} };
    });

    const fallback = new FallbackRunner(primary, secondary, n => swapNotes.push(n));
    const res1 = await fallback.httpGet('http://x/y', {});
    expect(res1.body).toBe('rescued');
    expect(primaryCalls).toBe(1); // tried once, failed
    expect(secondaryCalls).toBe(1); // rescued

    // Subsequent calls go straight to secondary.
    const res2 = await fallback.httpGet('http://x/z', {});
    expect(res2.body).toBe('rescued');
    expect(primaryCalls).toBe(1);
    expect(secondaryCalls).toBe(2);

    // Note fired exactly once.
    expect(swapNotes).toHaveLength(1);
    expect(swapNotes[0]).toMatch(/secondary/);
  });

  it('does NOT swap on a non-transport error (HTTP 500)', async () => {
    const primary: IDoctorRunner = makeStubRunner('primary', () =>
      ({ status: 500, body: 'oops', headers: {} }));
    const secondary: IDoctorRunner = makeStubRunner('secondary', () => {
      throw new Error('should not be called');
    });

    const fallback = new FallbackRunner(primary, secondary);
    const res = await fallback.httpGet('http://x/y', {});
    expect(res.status).toBe(500);
  });
});

// TODO: integration test exercising DockerExecRunner against a real
// docker daemon — requires a running synap-backend container, so this
// lives outside the unit suite. Run via `eve doctor` on a host where
// the loopback is unreachable to validate end-to-end.
describe('DockerExecRunner (constructor smoke)', () => {
  it('instantiates without throwing', () => {
    expect(() => new DockerExecRunner()).not.toThrow();
  });
});

function makeStubRunner(
  name: string,
  reply: () => DoctorRunnerResponse,
): IDoctorRunner {
  return {
    name,
    async httpGet(): Promise<DoctorRunnerResponse> { return reply(); },
    async httpPost(): Promise<DoctorRunnerResponse> { return reply(); },
    async httpDelete(): Promise<DoctorRunnerResponse> { return reply(); },
    async httpStream(): Promise<DoctorRunnerStream> {
      const r = reply();
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: r.headers,
        close: async () => { /* no-op */ },
        error: r.error,
      };
    },
  };
}
