import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import {
  buildWgetArgs,
  rewriteUrlForDockerExec,
  FallbackRunner,
  FetchRunner,
  DockerExecRunner,
} from '../src/lib/doctor-runners.js';
import type { IDoctorRunner, DoctorRunnerResponse, DoctorRunnerStream } from '@eve/lifecycle';

describe('rewriteUrlForDockerExec', () => {
  it('rewrites loopback URLs to the in-network synap-backend host', () => {
    expect(rewriteUrlForDockerExec('http://127.0.0.1:4000/api/hub/openapi.json'))
      .toBe('http://synap-backend-backend-1:4000/api/hub/openapi.json');
    expect(rewriteUrlForDockerExec('http://localhost:4000/api/hub/users/me'))
      .toBe('http://synap-backend-backend-1:4000/api/hub/users/me');
  });

  it('leaves public URLs untouched', () => {
    expect(rewriteUrlForDockerExec('https://pod.hyperray.shop/api/hub/openapi.json'))
      .toBe('https://pod.hyperray.shop/api/hub/openapi.json');
    expect(rewriteUrlForDockerExec('http://my-pod.example.com:4000/foo'))
      .toBe('http://my-pod.example.com:4000/foo');
  });

  it('returns malformed URLs unchanged', () => {
    expect(rewriteUrlForDockerExec('not-a-url')).toBe('not-a-url');
  });
});

describe('buildWgetArgs', () => {
  it('builds a BusyBox-compatible argv for GET via docker exec eve-legs-traefik', () => {
    const built = buildWgetArgs(
      'GET',
      'http://synap-backend-backend-1:4000/api/hub/openapi.json',
      { Authorization: 'Bearer key', Accept: 'application/json' },
      undefined,
      6,
    );
    if (!built.supported) throw new Error('GET should always be supported');
    const { container, argv } = built;
    expect(container).toBe('eve-legs-traefik');
    // First two argv entries describe the docker exec target.
    // No `-i` flag — we never pipe stdin, so dropping it avoids a
    // dangling pipe that some shells interpret oddly.
    expect(argv.slice(0, 2)).toEqual(['exec', 'eve-legs-traefik']);
    expect(argv).toContain('wget');
    // BusyBox-compatible short flags only.
    expect(argv).toContain('-q');
    expect(argv).toContain('-S');
    // -O - writes body to stdout (two adjacent args).
    expect(argv.slice(argv.indexOf('-O'), argv.indexOf('-O') + 2)).toEqual(['-O', '-']);
    // -T <sec> — separate args, value as a string.
    expect(argv.slice(argv.indexOf('-T'), argv.indexOf('-T') + 2)).toEqual(['-T', '6']);
    // --header HDR uses the separate-arg form (BusyBox accepts only this).
    const hdrIdx = argv.indexOf('--header');
    expect(hdrIdx).toBeGreaterThan(-1);
    // Either the Authorization or Accept header lands on the first --header.
    const headerValues = argv
      .map((arg, i) => (arg === '--header' ? argv[i + 1] : null))
      .filter((v): v is string => typeof v === 'string');
    expect(headerValues).toContain('Authorization: Bearer key');
    expect(headerValues).toContain('Accept: application/json');
    // No GNU-only flags should be present.
    expect(argv.find(a => a.startsWith('--method='))).toBeUndefined();
    expect(argv.find(a => a.startsWith('--header='))).toBeUndefined();
    expect(argv.find(a => a.startsWith('--timeout='))).toBeUndefined();
    expect(argv.find(a => a.startsWith('--quiet'))).toBeUndefined();
    expect(argv.find(a => a.startsWith('--server-response'))).toBeUndefined();
    // URL is the last arg.
    expect(argv[argv.length - 1]).toBe('http://synap-backend-backend-1:4000/api/hub/openapi.json');
  });

  it('uses --post-data for POST bodies (BusyBox does not support --body-data=)', () => {
    const built = buildWgetArgs('POST', 'http://x/y', {}, '{"foo":1}', 6);
    if (!built.supported) throw new Error('POST should be supported');
    const idx = built.argv.indexOf('--post-data');
    expect(idx).toBeGreaterThan(-1);
    expect(built.argv[idx + 1]).toBe('{"foo":1}');
  });

  it('reports DELETE as unsupported (BusyBox cannot issue DELETE)', () => {
    const built = buildWgetArgs('DELETE', 'http://x/y', {}, undefined, 6);
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
