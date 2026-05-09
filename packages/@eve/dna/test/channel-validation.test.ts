import { describe, expect, it, vi } from 'vitest';
import { validateChannelCredentials } from '../src/channel-validation.js';

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; ok?: boolean; body: unknown }): typeof fetch {
  return (vi.fn(async (url: string, init?: RequestInit) => {
    const r = handler(url, init);
    return {
      status: r.status ?? (r.ok === false ? 500 : 200),
      ok: r.ok ?? (r.status ? r.status < 400 : true),
      json: async () => r.body,
    } as Response;
  }) as unknown) as typeof fetch;
}

describe('validateChannelCredentials', () => {
  describe('telegram', () => {
    it('returns ok with bot username on getMe success', async () => {
      const f = mockFetch((url) => {
        expect(url).toContain('https://api.telegram.org/bot');
        expect(url).toContain('/getMe');
        return { body: { ok: true, result: { username: 'eve_bot', id: 123 } } };
      });
      const r = await validateChannelCredentials({ platform: 'telegram', botToken: 'abc:def' }, { fetch: f });
      expect(r.ok).toBe(true);
      expect(r.details).toBe('@eve_bot');
    });

    it('returns the description on ok=false', async () => {
      const f = mockFetch(() => ({ body: { ok: false, description: 'Unauthorized' } }));
      const r = await validateChannelCredentials({ platform: 'telegram', botToken: 'bad' }, { fetch: f });
      expect(r.ok).toBe(false);
      expect(r.error).toBe('Unauthorized');
    });

    it('encodes the token in the URL', async () => {
      let captured = '';
      const f = mockFetch((url) => { captured = url; return { body: { ok: true, result: { id: 1 } } }; });
      await validateChannelCredentials({ platform: 'telegram', botToken: 'a/b:c' }, { fetch: f });
      expect(captured).toContain('a%2Fb%3Ac');
    });
  });

  describe('discord', () => {
    it('returns ok with username#discriminator', async () => {
      const f = mockFetch((url, init) => {
        expect(url).toBe('https://discord.com/api/v10/users/@me');
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bot tok');
        return { body: { username: 'eve', discriminator: '4242', id: '999' } };
      });
      const r = await validateChannelCredentials({ platform: 'discord', botToken: 'tok' }, { fetch: f });
      expect(r.ok).toBe(true);
      expect(r.details).toBe('eve#4242');
    });

    it('omits discriminator when it is "0"', async () => {
      const f = mockFetch(() => ({ body: { username: 'eve', discriminator: '0', id: '999' } }));
      const r = await validateChannelCredentials({ platform: 'discord', botToken: 'tok' }, { fetch: f });
      expect(r.details).toBe('eve');
    });

    it('flags 401 with a clear error', async () => {
      const f = mockFetch(() => ({ status: 401, body: {} }));
      const r = await validateChannelCredentials({ platform: 'discord', botToken: 'bad' }, { fetch: f });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('401');
    });
  });

  describe('slack', () => {
    it('returns ok with user@team', async () => {
      const f = mockFetch((url) => {
        expect(url).toBe('https://slack.com/api/auth.test');
        return { body: { ok: true, user: 'evebot', team: 'synap' } };
      });
      const r = await validateChannelCredentials({ platform: 'slack', botToken: 'tok', signingSecret: 's' }, { fetch: f });
      expect(r.ok).toBe(true);
      expect(r.details).toBe('evebot@synap');
    });

    it('returns slack error code on ok=false', async () => {
      const f = mockFetch(() => ({ body: { ok: false, error: 'invalid_auth' } }));
      const r = await validateChannelCredentials({ platform: 'slack', botToken: 'bad', signingSecret: 's' }, { fetch: f });
      expect(r.ok).toBe(false);
      expect(r.error).toBe('invalid_auth');
    });
  });

  describe('matrix', () => {
    it('returns ok with user_id', async () => {
      const f = mockFetch((url) => {
        expect(url).toBe('https://matrix.example.com/_matrix/client/v3/account/whoami');
        return { body: { user_id: '@eve:example.com' } };
      });
      const r = await validateChannelCredentials(
        { platform: 'matrix', homeserverUrl: 'https://matrix.example.com/', accessToken: 'tok' },
        { fetch: f },
      );
      expect(r.ok).toBe(true);
      expect(r.details).toBe('@eve:example.com');
    });
  });

  describe('signal', () => {
    it('skips validation', async () => {
      const f = mockFetch(() => { throw new Error('should not be called'); });
      const r = await validateChannelCredentials(
        { platform: 'signal', phoneNumber: '+1234' },
        { fetch: f },
      );
      expect(r.ok).toBe(true);
      expect(r.skipped).toBe(true);
    });
  });

  it('reports network errors', async () => {
    const f = (() => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const r = await validateChannelCredentials({ platform: 'telegram', botToken: 'tok' }, { fetch: f });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });
});
