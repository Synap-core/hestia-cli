import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSynapAsOpenwebuiToolServer } from '../src/openwebui-tools-sync.js';
import * as openwebuiAdmin from '../src/openwebui-admin.js';
import type { EveSecrets } from '../src/secrets-contract.js';

const HUB_BASE = 'http://eve-brain-synap:4000/api/hub';
const EXPECTED_OPENAPI_URL = 'http://eve-brain-synap:4000/api/hub/openapi.json';

const VALID_OPENAPI_DOC = {
  openapi: '3.1.0',
  info: { title: 'Synap Hub Protocol', version: '1.0.0' },
  paths: {
    '/health': { get: {} },
    '/memory/search': { post: {} },
    '/entities': { post: {} },
    '/entities/{id}': { get: {} },
  },
};

function makeSecrets(hubApiKey = 'eve-test-key'): EveSecrets {
  return {
    version: '1',
    updatedAt: '2026-05-09T00:00:00.000Z',
    agents: {
      eve: {
        hubApiKey,
        agentUserId: 'user-eve',
        workspaceId: 'ws-eve',
      },
    },
  };
}

interface FetchCall {
  url: string;
  method?: string;
  body?: string;
}

/**
 * Build a fetch mock that responds based on URL + method. Captures every
 * call so tests can assert ordering and payloads.
 */
function buildFetchMock(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? String(init.body) : undefined;
    const call: FetchCall = { url, method, body };
    calls.push(call);
    return handler(call);
  });
  return { fn, calls };
}

describe('registerSynapAsOpenwebuiToolServer', () => {
  beforeEach(() => {
    vi.spyOn(openwebuiAdmin, 'getAdminJwt').mockResolvedValue('admin-jwt');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers Synap tool server on a fresh OpenWebUI', async () => {
    const { fn, calls } = buildFetchMock(async ({ url, method }) => {
      if (url === EXPECTED_OPENAPI_URL) {
        return new Response(JSON.stringify(VALID_OPENAPI_DOC), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/configs/tool_servers') && method === 'GET') {
        // v0.9.4: dedicated sub-route returns `{ TOOL_SERVER_CONNECTIONS: [] }`.
        return new Response(JSON.stringify({ TOOL_SERVER_CONNECTIONS: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/configs/tool_servers') && method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fn);

    const result = await registerSynapAsOpenwebuiToolServer(
      '/eve-home',
      HUB_BASE,
      makeSecrets('eve-key'),
    );

    expect(result.registered).toBe(true);
    expect(result.toolCount).toBe(4);
    expect(result.serverName).toBe('Synap Hub Protocol');
    expect(result.endpointUrl).toBe(EXPECTED_OPENAPI_URL);

    const saveCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/v1/configs/tool_servers'));
    expect(saveCall).toBeDefined();
    const savedBody = JSON.parse(String(saveCall!.body)) as { TOOL_SERVER_CONNECTIONS: Array<Record<string, unknown>> };
    expect(savedBody.TOOL_SERVER_CONNECTIONS).toHaveLength(1);
    expect(savedBody.TOOL_SERVER_CONNECTIONS[0]).toEqual({
      url: EXPECTED_OPENAPI_URL,
      path: '',
      type: 'openapi',
      auth_type: 'bearer',
      key: 'eve-key',
      name: 'Synap Hub Protocol',
      config: {},
    });
  });

  it('is a no-op when already registered with the same URL and key', async () => {
    const existingConnections = [
      {
        url: EXPECTED_OPENAPI_URL,
        path: '',
        type: 'openapi' as const,
        auth_type: 'bearer',
        key: 'eve-key',
        name: 'Synap Hub Protocol',
      },
    ];
    const { fn, calls } = buildFetchMock(async ({ url, method }) => {
      if (url === EXPECTED_OPENAPI_URL) {
        return new Response(JSON.stringify(VALID_OPENAPI_DOC), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/configs/tool_servers') && method === 'GET') {
        return new Response(JSON.stringify({ TOOL_SERVER_CONNECTIONS: existingConnections }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/configs/tool_servers') && method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fn);

    const result = await registerSynapAsOpenwebuiToolServer(
      '/eve-home',
      HUB_BASE,
      makeSecrets('eve-key'),
    );

    expect(result.registered).toBe(true);
    expect(result.toolCount).toBe(4);
    const savePosts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/v1/configs/tool_servers'));
    expect(savePosts).toHaveLength(0);
  });

  it('updates the registration when the bearer key changes', async () => {
    const existingConnections = [
      {
        url: EXPECTED_OPENAPI_URL,
        path: '',
        type: 'openapi' as const,
        auth_type: 'bearer',
        key: 'old-key',
        name: 'Synap Hub Protocol',
      },
    ];
    const { fn, calls } = buildFetchMock(async ({ url, method }) => {
      if (url === EXPECTED_OPENAPI_URL) {
        return new Response(JSON.stringify(VALID_OPENAPI_DOC), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/configs/tool_servers') && method === 'GET') {
        return new Response(JSON.stringify({ TOOL_SERVER_CONNECTIONS: existingConnections }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/configs/tool_servers') && method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fn);

    const result = await registerSynapAsOpenwebuiToolServer(
      '/eve-home',
      HUB_BASE,
      makeSecrets('new-key'),
    );

    expect(result.registered).toBe(true);

    const saveCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/v1/configs/tool_servers'));
    expect(saveCall).toBeDefined();
    const savedBody = JSON.parse(String(saveCall!.body)) as { TOOL_SERVER_CONNECTIONS: Array<Record<string, unknown>> };
    expect(savedBody.TOOL_SERVER_CONNECTIONS).toHaveLength(1);
    expect(savedBody.TOOL_SERVER_CONNECTIONS[0]).toMatchObject({
      url: EXPECTED_OPENAPI_URL,
      key: 'new-key',
      name: 'Synap Hub Protocol',
    });
  });

  it('preserves unrelated tool server connections when updating', async () => {
    const existingConnections = [
      {
        url: 'http://other-tool/openapi.json',
        path: '',
        type: 'openapi' as const,
        auth_type: 'bearer',
        key: 'other-key',
        name: 'Some Other Tool',
      },
    ];
    const { fn, calls } = buildFetchMock(async ({ url, method }) => {
      if (url === EXPECTED_OPENAPI_URL) {
        return new Response(JSON.stringify(VALID_OPENAPI_DOC), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/configs/tool_servers') && method === 'GET') {
        return new Response(JSON.stringify({ TOOL_SERVER_CONNECTIONS: existingConnections }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/v1/configs/tool_servers') && method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fn);

    await registerSynapAsOpenwebuiToolServer(
      '/eve-home',
      HUB_BASE,
      makeSecrets('eve-key'),
    );

    const saveCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/v1/configs/tool_servers'));
    const savedBody = JSON.parse(String(saveCall!.body)) as { TOOL_SERVER_CONNECTIONS: Array<Record<string, unknown>> };
    expect(savedBody.TOOL_SERVER_CONNECTIONS).toHaveLength(2);
    expect(savedBody.TOOL_SERVER_CONNECTIONS.find((c) => c.name === 'Some Other Tool')).toMatchObject({
      url: 'http://other-tool/openapi.json',
      key: 'other-key',
      name: 'Some Other Tool',
    });
    expect(savedBody.TOOL_SERVER_CONNECTIONS.find((c) => c.name === 'Synap Hub Protocol')).toMatchObject({
      url: EXPECTED_OPENAPI_URL,
      key: 'eve-key',
    });
  });

  it('throws when the OpenWebUI admin login fails', async () => {
    vi.spyOn(openwebuiAdmin, 'getAdminJwt').mockResolvedValue(null);
    const { fn } = buildFetchMock(async ({ url }) => {
      if (url === EXPECTED_OPENAPI_URL) {
        return new Response(JSON.stringify(VALID_OPENAPI_DOC), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fn);

    await expect(
      registerSynapAsOpenwebuiToolServer('/eve-home', HUB_BASE, makeSecrets('eve-key')),
    ).rejects.toThrow(/admin login failed/i);
  });

  it('returns registered=false without throwing when the Synap OpenAPI endpoint 404s', async () => {
    const { fn, calls } = buildFetchMock(async ({ url }) => {
      if (url === EXPECTED_OPENAPI_URL) {
        return new Response('not found', { status: 404 });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fn);

    const result = await registerSynapAsOpenwebuiToolServer(
      '/eve-home',
      HUB_BASE,
      makeSecrets('eve-key'),
    );

    expect(result.registered).toBe(false);
    expect(result.toolCount).toBe(0);
    expect(result.endpointUrl).toBe(EXPECTED_OPENAPI_URL);
    expect(result.serverName).toBe('Synap Hub Protocol');

    // No admin calls when the upstream endpoint is missing.
    expect(calls.some((c) => c.url.endsWith('/api/v1/configs/tool_servers'))).toBe(false);
  });
});
