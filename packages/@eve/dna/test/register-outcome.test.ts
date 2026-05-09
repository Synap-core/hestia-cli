import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the admin module's stage helpers so we can drive each branch of
// `registerOpenwebuiAdminApi` deterministically and assert the resulting
// RegisterOutcome shape.
const waitForHealthDetailedMock = vi.fn();
const getAdminJwtPostHealthDetailedMock = vi.fn();
const probeAdminAuthMock = vi.fn();
const reconcileMock = vi.fn();
const registerPipelineMock = vi.fn();

vi.mock('../src/openwebui-admin.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/openwebui-admin.js')>();
  return {
    ...real,
    waitForHealthDetailed: (...args: unknown[]) => waitForHealthDetailedMock(...args),
    getAdminJwtPostHealthDetailed: () => getAdminJwtPostHealthDetailedMock(),
    probeAdminAuth: (...args: unknown[]) => probeAdminAuthMock(...args),
    reconcileOpenwebuiManagedConfigViaAdmin: (...args: unknown[]) => reconcileMock(...args),
    registerPipeline: (...args: unknown[]) => registerPipelineMock(...args),
  };
});

import { registerOpenwebuiAdminApi } from '../src/wire-ai.js';

const SOURCES = [{ url: 'http://x/v1', apiKey: 'k', displayName: 'Foo' }];

describe('registerOpenwebuiAdminApi → RegisterOutcome', () => {
  beforeEach(() => {
    waitForHealthDetailedMock.mockReset();
    getAdminJwtPostHealthDetailedMock.mockReset();
    probeAdminAuthMock.mockReset();
    reconcileMock.mockReset();
    registerPipelineMock.mockReset();
  });

  it('stage="health" when loopback times out', async () => {
    waitForHealthDetailedMock.mockResolvedValue({
      ok: false,
      baseUrl: 'http://127.0.0.1:3011',
      reason: 'loopback timed out, internal probe also failed',
    });

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('health');
      expect(r.reason).toMatch(/loopback timed out/);
    }
    expect(getAdminJwtPostHealthDetailedMock).not.toHaveBeenCalled();
  });

  it('stage="secret-key" when WEBUI_SECRET_KEY is missing', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({
      ok: false,
      stage: 'secret-key',
      reason: 'WEBUI_SECRET_KEY missing in /opt/openwebui/.env',
    });

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('secret-key');
      expect(r.reason).toMatch(/WEBUI_SECRET_KEY/);
    }
  });

  it('stage="admin-row" carries stderr from docker exec', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({
      ok: false,
      stage: 'admin-row',
      reason: "docker exec failed: sqlite3.OperationalError: no such table: user",
    });

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('admin-row');
      expect(r.reason).toContain('no such table');
    }
    expect(probeAdminAuthMock).not.toHaveBeenCalled();
  });

  it('stage="jwt-rejected" when admin probe returns 401', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({ ok: true, jwt: 'forged' });
    probeAdminAuthMock.mockResolvedValue({ ok: false, status: 401, body: 'Unauthorized' });

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('jwt-rejected');
      expect(r.reason).toContain('401');
    }
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('stage="jwt-rejected" also fires on 403', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({ ok: true, jwt: 'forged' });
    probeAdminAuthMock.mockResolvedValue({ ok: false, status: 403, body: 'Forbidden' });

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    if (!r.ok) {
      expect(r.stage).toBe('jwt-rejected');
      expect(r.reason).toContain('403');
    }
  });

  it('stage="reconcile" when probe is reachable but config save returns null', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({ ok: true, jwt: 'forged' });
    probeAdminAuthMock.mockResolvedValue({ ok: true, status: 200, body: '{}' });
    reconcileMock.mockResolvedValue(null);

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('reconcile');
    }
  });

  it('stage="reconcile" when reconcile throws', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({ ok: true, jwt: 'forged' });
    probeAdminAuthMock.mockResolvedValue({ ok: true, status: 200, body: '{}' });
    reconcileMock.mockRejectedValue(new Error('connection reset'));

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('reconcile');
      expect(r.reason).toContain('connection reset');
    }
  });

  it('ok:true on full success — no pipelines', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({ ok: true, jwt: 'forged' });
    probeAdminAuthMock.mockResolvedValue({ ok: true, status: 200, body: '{}' });
    reconcileMock.mockResolvedValue({ config: {}, changed: true, changedKeys: ['openai'] });

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(true);
    expect(registerPipelineMock).not.toHaveBeenCalled();
  });
});
