/**
 * openwebui-user-provision.ts — Unit Tests
 *
 * Tests the provisionOwuiUserInSynap function:
 * - Successful first mint returns a token
 * - Idempotent: reused=true path returns token:null
 * - Missing env vars throw descriptive errors before any HTTP call
 * - HTTP error responses throw with status info
 * - Options override env vars
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Stub global fetch before importing the module under test
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { provisionOwuiUserInSynap } from '../src/openwebui-user-provision.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, statusText: string): Response {
  return new Response('', { status, statusText });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('provisionOwuiUserInSynap', () => {
  const validOpts = {
    owuiUserId: 'owui-user-42',
    owuiUserName: 'Alice',
    podUrl: 'http://pod.local:4000',
    agentApiKey: 'synap_hub_test_abc123',
  };

  beforeEach(() => {
    mockFetch.mockReset();
    // Clear env vars that might bleed between tests
    delete process.env.SYNAP_POD_URL;
    delete process.env.SYNAP_AGENT_API_KEY;
  });

  afterEach(() => {
    delete process.env.SYNAP_POD_URL;
    delete process.env.SYNAP_AGENT_API_KEY;
  });

  it('returns token and synapUserId on successful first mint', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ token: 'synap_hub_sub_xyz789', synapUserId: 'usr-001', reused: false }),
    );

    const result = await provisionOwuiUserInSynap(validOpts);

    expect(result.token).toBe('synap_hub_sub_xyz789');
    expect(result.synapUserId).toBe('usr-001');
    expect(result.reused).toBe(false);
  });

  it('returns token:null and reused:true when sub-token already existed', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ token: undefined, synapUserId: 'usr-001', reused: true }),
    );

    const result = await provisionOwuiUserInSynap(validOpts);

    expect(result.token).toBeNull();
    expect(result.synapUserId).toBe('usr-001');
    expect(result.reused).toBe(true);
  });

  it('sends the correct POST payload and Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ synapUserId: 'usr-002' }),
    );

    await provisionOwuiUserInSynap(validOpts);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://pod.local:4000/api/hub/setup/external-user');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer synap_hub_test_abc123',
    );
    const body = JSON.parse(init.body as string);
    expect(body.externalUserId).toBe('owui-user-42');
    expect(body.name).toBe('Alice');
    expect(body.mintSubToken).toBe(true);
  });

  it('strips trailing slash from podUrl before building the endpoint URL', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ synapUserId: 'usr-003' }));

    await provisionOwuiUserInSynap({ ...validOpts, podUrl: 'http://pod.local:4000///' });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://pod.local:4000/api/hub/setup/external-user');
  });

  it('falls back to SYNAP_POD_URL env var when podUrl option is absent', async () => {
    process.env.SYNAP_POD_URL = 'http://env-pod:4000';
    mockFetch.mockResolvedValueOnce(okResponse({ synapUserId: 'usr-env' }));

    const { podUrl: _omit, ...optsWithoutPodUrl } = validOpts;
    await provisionOwuiUserInSynap(optsWithoutPodUrl);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('http://env-pod:4000');
  });

  it('falls back to SYNAP_AGENT_API_KEY env var when agentApiKey option is absent', async () => {
    process.env.SYNAP_AGENT_API_KEY = 'synap_hub_env_key';
    mockFetch.mockResolvedValueOnce(okResponse({ synapUserId: 'usr-env' }));

    const { agentApiKey: _omit, ...optsWithoutKey } = validOpts;
    await provisionOwuiUserInSynap(optsWithoutKey);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer synap_hub_env_key',
    );
  });

  it('throws a clear error when podUrl is not provided and env var is absent', async () => {
    const { podUrl: _omit, ...optsWithoutPodUrl } = validOpts;
    await expect(provisionOwuiUserInSynap(optsWithoutPodUrl)).rejects.toThrow(
      /SYNAP_POD_URL/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws a clear error when agentApiKey is not provided and env var is absent', async () => {
    const { agentApiKey: _omit, ...optsWithoutKey } = validOpts;
    await expect(provisionOwuiUserInSynap(optsWithoutKey)).rejects.toThrow(
      /SYNAP_AGENT_API_KEY/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws with HTTP status info when the server returns a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

    await expect(provisionOwuiUserInSynap(validOpts)).rejects.toThrow(/403/);
  });

  it('throws on 500 server error', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'));

    await expect(provisionOwuiUserInSynap(validOpts)).rejects.toThrow(/500/);
  });

  it('defaults reused to false when the server omits the field', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ token: 'synap_hub_sub_new', synapUserId: 'usr-004' }),
    );

    const result = await provisionOwuiUserInSynap(validOpts);
    expect(result.reused).toBe(false);
  });

  it('defaults token to null when the server omits the field', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ synapUserId: 'usr-005' }));

    const result = await provisionOwuiUserInSynap(validOpts);
    expect(result.token).toBeNull();
  });
});
