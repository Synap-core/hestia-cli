import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import {
  buildWgetArgs,
  FallbackRunner,
  FetchRunner,
  DockerExecRunner,
} from '../src/lib/doctor-runners.js';
import type { IDoctorRunner, DoctorRunnerResponse, DoctorRunnerStream } from '@eve/lifecycle';

describe('buildWgetArgs', () => {
  it('builds a BusyBox-compatible argv for GET into the supplied container', () => {
    const built = buildWgetArgs(
      'GET',
      'http://127.0.0.1:4000/api/hub/openapi.json',
      { Authorization: 'Bearer key', Accept: 'application/json' },
      undefined,
      6,
      'synap-backend-backend-1',
    );
    if (!built.supported) throw new Error('GET should always be supported');
    const { container, argv } = built;
    expect(container).toBe('synap-backend-backend-1');
    // First two argv entries describe the docker exec target.
    expect(argv.slice(0, 2)).toEqual(['exec', 'synap-backend-backend-1']);
    expect(argv).toContain('wget');
    // BusyBox-compatible short flags only.
    expect(argv).toContain('-q');
    expect(argv).toContain('-S');
    // -O - writes body to stdout (two adjacent args).
    expect(argv.slice(argv.indexOf('-O'), argv.indexOf('-O') + 2)).toEqual(['-O', '-']);
    // -T <sec> — separate args, value as a string.
    expect(argv.slice(argv.indexOf('-T'), argv.indexOf('-T') + 2)).toEqual(['-T', '6']);
    // Headers use the `=` form (single argv) — BusyBox wget treats
    // `--post-data VAL` (space form) as if --post-data had no value,
    // breaking POST. We pin every long opt to `=` form to avoid that
    // class of bug.
    const headerArgs = argv.filter(a => a.startsWith('--header='));
    expect(headerArgs).toContain('--header=Authorization: Bearer key');
    expect(headerArgs).toContain('--header=Accept: application/json');
    // Bare --header with separate value MUST NOT be used.
    expect(argv.find(a => a === '--header')).toBeUndefined();
    // No other GNU-only flags should be present.
    expect(argv.find(a => a.startsWith('--method='))).toBeUndefined();
    expect(argv.find(a => a.startsWith('--timeout='))).toBeUndefined();
    expect(argv.find(a => a.startsWith('--quiet'))).toBeUndefined();
    expect(argv.find(a => a.startsWith('--server-response'))).toBeUndefined();
    // URL is the last arg.
    expect(argv[argv.length - 1]).toBe('http://127.0.0.1:4000/api/hub/openapi.json');
  });

  it('uses --post-data=VALUE single-argv form (BusyBox space form drops the body)', () => {
    const built = buildWgetArgs('POST', 'http://x/y', {}, '{"foo":1}', 6, 'some-container');
    if (!built.supported) throw new Error('POST should be supported');
    // `=` form: single argv element. NOT the space form (`--post-data` then value).
    expect(built.argv).toContain('--post-data={"foo":1}');
    expect(built.argv.find(a => a === '--post-data')).toBeUndefined();
  });

  it('reports DELETE as unsupported (BusyBox cannot issue DELETE)', () => {
    const built = buildWgetArgs('DELETE', 'http://x/y', {}, undefined, 6, 'some-container');
    expect(built.supported).toBe(false);
    if (built.supported) throw new Error('DELETE should be unsupported');
    expect(built.reason).toMatch(/BusyBox/);
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
// docker daemon — requires a running eve-legs-traefik container, so
// this lives outside the unit suite. Run via `eve doctor` on a host
// where the loopback is unreachable to validate end-to-end.
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
