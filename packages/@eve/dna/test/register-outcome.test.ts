import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the admin module's stage helpers so we can drive each branch of
// `registerOpenwebuiAdminApi` deterministically and assert the resulting
// RegisterOutcome shape.
const waitForHealthDetailedMock = vi.fn();
const getAdminJwtPostHealthDetailedMock = vi.fn();
const probeAdminAuthMock = vi.fn();
const reconcileDetailedMock = vi.fn();
const registerPipelineMock = vi.fn();

vi.mock('../src/openwebui-admin.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/openwebui-admin.js')>();
  return {
    ...real,
    waitForHealthDetailed: (...args: unknown[]) => waitForHealthDetailedMock(...args),
    getAdminJwtPostHealthDetailed: () => getAdminJwtPostHealthDetailedMock(),
    probeAdminAuth: (...args: unknown[]) => probeAdminAuthMock(...args),
    reconcileOpenwebuiManagedConfigViaAdminDetailed: (...args: unknown[]) => reconcileDetailedMock(...args),
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
    reconcileDetailedMock.mockReset();
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
    expect(reconcileDetailedMock).not.toHaveBeenCalled();
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

  it('stage="reconcile" surfaces getConfig HTTP status + body preview', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({ ok: true, jwt: 'forged' });
    probeAdminAuthMock.mockResolvedValue({ ok: true, status: 200, body: '{}' });
    reconcileDetailedMock.mockResolvedValue({
      ok: false,
      step: 'getConfig',
      status: 200,
      bodyPreview: '<!DOCTYPE html><html...',
      reason: 'OWUI returned HTML at /api/v1/configs/ (likely SPA shell)',
    });

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('reconcile');
      expect(r.reason).toContain('getConfig failed');
      expect(r.reason).toContain('HTML');
      expect(r.reason).toContain('<!DOCTYPE');
    }
  });

  it('stage="reconcile" surfaces saveConfig 4xx body', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({ ok: true, jwt: 'forged' });
    probeAdminAuthMock.mockResolvedValue({ ok: true, status: 200, body: '{}' });
    reconcileDetailedMock.mockResolvedValue({
      ok: false,
      step: 'saveConfig',
      status: 422,
      bodyPreview: '{"detail":"field foo is read-only"}',
      reason: 'HTTP 422',
    });

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('reconcile');
      expect(r.reason).toContain('saveConfig failed');
      expect(r.reason).toContain('422');
      expect(r.reason).toContain('read-only');
    }
  });

  it('stage="reconcile" when reconcile throws unexpectedly', async () => {
    waitForHealthDetailedMock.mockResolvedValue({ ok: true, baseUrl: 'http://127.0.0.1:3011' });
    getAdminJwtPostHealthDetailedMock.mockResolvedValue({ ok: true, jwt: 'forged' });
    probeAdminAuthMock.mockResolvedValue({ ok: true, status: 200, body: '{}' });
    reconcileDetailedMock.mockRejectedValue(new Error('connection reset'));

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
    reconcileDetailedMock.mockResolvedValue({
      ok: true,
      result: { config: {}, changed: true, changedKeys: ['openai'] },
    });

    const r = await registerOpenwebuiAdminApi(SOURCES, {});

    expect(r.ok).toBe(true);
    expect(registerPipelineMock).not.toHaveBeenCalled();
  });
});
