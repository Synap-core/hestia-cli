/**
 * `eve postiz connect` — the way back. After the apply, connect asks the pod's
 * one door (`POST /api/hub/tools/:id/webhook`) for the postiz tool's webhook
 * URL, and flags a URL Postiz's SSRF guard would refuse.
 *
 * Driven through the REAL `connectPostizWebhook` → `postToolWebhook` →
 * `fetch` (stubbed at the global), so the path, method and Bearer key the pod
 * sees are asserted, not assumed. DNS is injected.
 *
 * NOT COVERED: the printed text of `runConnect` (it needs an installed
 * component, ~/.eve secrets and a live pod) and Postiz actually delivering.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectPostizWebhook,
  postizUnreachableReason,
} from '../src/commands/postiz.js';
import type { ApplyCapabilityResponse } from '../src/commands/capabilities.js';

const CONN = { synapUrl: 'http://127.0.0.1:4000/', apiKey: 'hub-key' };
const TOOL = '0bbbbbbb-0000-4000-8000-000000000002';
const URL = `https://pod.example.com/api/webhooks/postiz/${'t'.repeat(43)}`;
const PUBLIC = async () => ['203.0.113.7'];

function applied(tools: Record<string, unknown>[]): ApplyCapabilityResponse {
  return { capabilityKey: 'postiz', created: { vault: [], tools, skills: [] }, proposals: [] };
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('connectPostizWebhook', () => {
  it("asks the pod's webhook door for the postiz tool and returns its URL", async () => {
    const webhook = {
      provider: 'postiz',
      url: URL,
      rotated: false,
      missingConfig: [],
      setupStep: 'In Postiz, open Settings → Webhooks …',
    };
    const fetchMock = stubFetch(200, webhook);
    const out = await connectPostizWebhook(
      CONN,
      applied([
        { name: 'other', status: 'created', toolId: 'x' },
        { name: 'postiz', status: 'created', toolId: TOOL },
      ]),
      PUBLIC,
    );
    expect(out).toEqual({ kind: 'ready', webhook, unreachable: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:4000/api/hub/tools/${TOOL}/webhook`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hub-key');
  });

  it('a postiz tool still waiting on a proposal: pending, and the door is not called', async () => {
    const fetchMock = stubFetch(200, {});
    const out = await connectPostizWebhook(
      CONN,
      applied([{ name: 'postiz', status: 'proposed', toolId: null, proposalId: 'p1' }]),
      PUBLIC,
    );
    expect(out).toEqual({ kind: 'pending' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the apply named no postiz tool, or the pod refuses', async () => {
    stubFetch(200, {});
    await expect(connectPostizWebhook(CONN, applied([]), PUBLIC)).rejects.toThrow(/no postiz tool/);
    stubFetch(412, { error: 'This pod has no PUBLIC_URL' });
    await expect(
      connectPostizWebhook(CONN, applied([{ name: 'postiz', toolId: TOOL }]), PUBLIC),
    ).rejects.toThrow(/HTTP 412.*PUBLIC_URL/);
  });

  it('flags a URL Postiz would refuse', async () => {
    stubFetch(200, { provider: 'postiz', url: URL, rotated: false, missingConfig: [], setupStep: null });
    const out = await connectPostizWebhook(
      CONN,
      applied([{ name: 'postiz', toolId: TOOL }]),
      async () => ['192.168.1.20'],
    );
    expect(out).toMatchObject({ kind: 'ready', unreachable: expect.stringMatching(/192\.168\.1\.20/) });
  });
});

describe('postizUnreachableReason — the rule Postiz applies', () => {
  it.each([
    ['http://pod.example.com/x', PUBLIC, /not https/],
    ['https://localhost/x', PUBLIC, /this machine/],
    ['https://10.0.0.4/x', PUBLIC, /10\.0\.0\.4/],
    ['https://pod.lan/x', async () => ['100.101.1.2'], /100\.101\.1\.2/],
    ['https://pod.lan/x', async () => ['203.0.113.7', '::ffff:172.20.0.3'], /172\.20\.0\.3/],
    ['https://[::1]/x', PUBLIC, /::1/],
  ])('%s is refused', async (url, lookup, reason) => {
    expect(await postizUnreachableReason(url, lookup)).toMatch(reason);
  });

  it('a public https host passes', async () => {
    expect(await postizUnreachableReason(URL, PUBLIC)).toBeNull();
  });

  it('a host that does not resolve is reported, not passed', async () => {
    const fail = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await postizUnreachableReason(URL, fail)).toMatch(/does not resolve/);
  });
});
