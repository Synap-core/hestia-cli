import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configStore } from '../src/config-store.js';
import {
  configureChannel,
  disableChannel,
  readChannelStatus,
} from '../src/channel-credentials.js';
import { readEveSecrets, writeEveSecrets } from '../src/secrets-contract.js';

// Stub the cascade so tests don't try to write Hermes env files or restart
// containers. The mock returns a shape `summariseReconcile()` can interpret
// so the helper produces a non-empty summary string.
vi.mock('../src/reconcile.js', () => ({
  reconcile: vi.fn(async () => ({
    envSync: true,
    aiWiring: [],
    containerRecreates: [],
    traefikUpdate: false,
  })),
}));

const tmp = () => mkdtempSync(join(tmpdir(), 'eve-channels-'));

describe('configureChannel', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = tmp();
    configStore.reset();
  });

  afterEach(() => {
    configStore.reset();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('persists telegram credentials with enabled=true and default hermes routing', async () => {
    const result = await configureChannel(cwd, {
      platform: 'telegram',
      botToken: 'tg-secret-123',
      webhookSecret: 'wh-secret',
    });

    expect(result.wired).toBe(true);
    expect(result.reconcileSummary).toContain('Hermes env updated');

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channels?.telegram).toEqual({
      enabled: true,
      botToken: 'tg-secret-123',
      webhookSecret: 'wh-secret',
    });
    // Default routing ('hermes') should NOT be persisted as an explicit override.
    expect(secrets?.channelRouting?.telegram).toBeUndefined();
  });

  it('persists discord credentials with optional fields', async () => {
    await configureChannel(cwd, {
      platform: 'discord',
      botToken: 'dc-token',
      guildId: 'g123',
      applicationId: 'app456',
    });

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channels?.discord).toEqual({
      enabled: true,
      botToken: 'dc-token',
      guildId: 'g123',
      applicationId: 'app456',
    });
  });

  it('persists slack credentials including signing secret and app token', async () => {
    await configureChannel(cwd, {
      platform: 'slack',
      botToken: 'xoxb-…',
      signingSecret: 'sign-…',
      appToken: 'xapp-…',
    });

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channels?.slack).toEqual({
      enabled: true,
      botToken: 'xoxb-…',
      signingSecret: 'sign-…',
      appToken: 'xapp-…',
    });
  });

  it('persists signal credentials', async () => {
    await configureChannel(cwd, {
      platform: 'signal',
      phoneNumber: '+15555550100',
      apiUrl: 'http://signal-cli:8080',
    });

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channels?.signal).toEqual({
      enabled: true,
      phoneNumber: '+15555550100',
      apiUrl: 'http://signal-cli:8080',
    });
  });

  it('persists matrix credentials', async () => {
    await configureChannel(cwd, {
      platform: 'matrix',
      homeserverUrl: 'https://matrix.example.org',
      accessToken: 'mat-token',
      roomId: '!abc:matrix.example.org',
    });

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channels?.matrix).toEqual({
      enabled: true,
      homeserverUrl: 'https://matrix.example.org',
      accessToken: 'mat-token',
      roomId: '!abc:matrix.example.org',
    });
  });

  it('writes routing entry only when explicitly different from hermes default', async () => {
    await configureChannel(
      cwd,
      { platform: 'telegram', botToken: 't1' },
      { routing: 'openclaw' },
    );

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channelRouting?.telegram).toBe('openclaw');
  });

  it('clears prior non-default routing when caller switches back to hermes', async () => {
    await configureChannel(
      cwd,
      { platform: 'telegram', botToken: 't1' },
      { routing: 'openclaw' },
    );
    expect((await readEveSecrets(cwd))?.channelRouting?.telegram).toBe('openclaw');

    await configureChannel(
      cwd,
      { platform: 'telegram', botToken: 't2' },
      { routing: 'hermes' },
    );

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channelRouting?.telegram).toBeUndefined();
    expect(secrets?.channels?.telegram?.botToken).toBe('t2');
  });

  it('preserves credentials of other platforms when configuring one', async () => {
    await configureChannel(cwd, { platform: 'telegram', botToken: 'tg' });
    await configureChannel(cwd, {
      platform: 'matrix',
      homeserverUrl: 'https://m.example',
      accessToken: 'tok',
    });

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channels?.telegram?.botToken).toBe('tg');
    expect(secrets?.channels?.matrix?.accessToken).toBe('tok');
  });

  it('persists whatsapp cloud-api credentials', async () => {
    const result = await configureChannel(cwd, {
      platform: 'whatsapp',
      mode: 'cloud-api',
      phoneNumberId: 'pn-123',
      accessToken: 'EAAxxxx',
      verifyToken: 'my-verify-secret',
    });

    expect(result.wired).toBe(true);
    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channels?.whatsapp).toEqual({
      enabled: true,
      phoneNumberId: 'pn-123',
      accessToken: 'EAAxxxx',
      verifyToken: 'my-verify-secret',
    });
  });

  it('rejects whatsapp without cloud-api mode', async () => {
    await expect(
      configureChannel(cwd, {
        // Force the rejected branch — no mode field.
        platform: 'whatsapp',
        // @ts-expect-error — intentionally exercising the runtime guard.
        accessToken: 'x',
      }),
    ).rejects.toThrow(/WhatsApp/);
  });
});

describe('disableChannel', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = tmp();
    configStore.reset();
  });

  afterEach(() => {
    configStore.reset();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('flips enabled=false but keeps existing credentials in place', async () => {
    await configureChannel(cwd, {
      platform: 'telegram',
      botToken: 'still-here',
      webhookSecret: 'and-here',
    });

    await disableChannel(cwd, 'telegram');

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channels?.telegram).toEqual({
      enabled: false,
      botToken: 'still-here',
      webhookSecret: 'and-here',
    });
  });

  it('is idempotent on platforms that were never configured', async () => {
    await disableChannel(cwd, 'slack');

    const secrets = await readEveSecrets(cwd);
    expect(secrets?.channels?.slack).toEqual({ enabled: false });
  });
});

describe('readChannelStatus', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = tmp();
    configStore.reset();
  });

  afterEach(() => {
    configStore.reset();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns all 6 platforms as disabled with no creds when secrets file is empty', async () => {
    const rows = await readChannelStatus(cwd);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.platform).sort()).toEqual(
      ['discord', 'matrix', 'signal', 'slack', 'telegram', 'whatsapp'],
    );
    for (const row of rows) {
      expect(row.enabled).toBe(false);
      expect(row.hasCredentials).toBe(false);
      expect(row.routing).toBe('hermes');
    }
  });

  it('reports enabled+hasCredentials after configureChannel', async () => {
    await configureChannel(cwd, { platform: 'telegram', botToken: 'tg-token' });
    await configureChannel(
      cwd,
      { platform: 'slack', botToken: 'xoxb', signingSecret: 'ss' },
      { routing: 'openclaw' },
    );

    const rows = await readChannelStatus(cwd);
    const telegram = rows.find((r) => r.platform === 'telegram')!;
    const slack = rows.find((r) => r.platform === 'slack')!;
    const matrix = rows.find((r) => r.platform === 'matrix')!;

    expect(telegram.enabled).toBe(true);
    expect(telegram.hasCredentials).toBe(true);
    expect(telegram.routing).toBe('hermes');

    expect(slack.enabled).toBe(true);
    expect(slack.hasCredentials).toBe(true);
    expect(slack.routing).toBe('openclaw');

    expect(matrix.enabled).toBe(false);
    expect(matrix.hasCredentials).toBe(false);
  });

  it('reports hasCredentials=false when only enabled flag was flipped manually', async () => {
    // Simulate a partially-configured state — enabled but no token. Real
    // installs hit this when an earlier write was interrupted.
    await writeEveSecrets({ channels: { telegram: { enabled: true } } }, cwd);
    const rows = await readChannelStatus(cwd);
    const telegram = rows.find((r) => r.platform === 'telegram')!;
    expect(telegram.enabled).toBe(true);
    expect(telegram.hasCredentials).toBe(false);
  });
});
