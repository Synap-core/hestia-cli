import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reconcileOpenwebuiManagedConfig,
  reconcileOpenwebuiManagedConfigViaAdmin,
  type OpenWebuiConfig,
} from '../src/openwebui-admin.js';

describe('reconcileOpenwebuiManagedConfig', () => {
  it('upserts Eve-managed model sources while preserving user-owned config', () => {
    const current: OpenWebuiConfig = {
      openai: {
        api_base_urls: ['http://user-provider/v1', 'http://synap/v1'],
        api_keys: ['user-key', 'old-synap-key'],
        metadata: {
          'http://user-provider/v1': { name: 'User Provider', models: 'user/model' },
          'http://synap/v1': { name: 'Old Synap', models: 'synap/old' },
        },
      },
      WEBUI_NAME: 'Personal Chat',
      userOwned: { keep: true },
    };

    const result = reconcileOpenwebuiManagedConfig(current, {
      modelSources: [
        {
          url: 'http://synap/v1',
          apiKey: 'new-synap-key',
          displayName: 'Synap IS',
          models: ['synap/auto', 'synap/balanced'],
        },
        {
          url: 'http://new-provider/v1',
          apiKey: 'new-provider-key',
          displayName: 'New Provider',
        },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.config.userOwned).toEqual({ keep: true });
    expect(result.config.WEBUI_NAME).toBe('Personal Chat');
    expect(result.config.openai?.api_base_urls).toEqual([
      'http://user-provider/v1',
      'http://synap/v1',
      'http://new-provider/v1',
    ]);
    expect(result.config.openai?.api_keys).toEqual([
      'user-key',
      'new-synap-key',
      'new-provider-key',
    ]);
    expect(result.config.openai?.metadata?.['http://user-provider/v1']).toEqual({
      name: 'User Provider',
      models: 'user/model',
    });
    expect(result.config.openai?.metadata?.['http://synap/v1']).toEqual({
      name: 'Synap IS',
      models: 'synap/auto;synap/balanced',
    });
  });

  it('reconciles managed root keys and preserves existing default model shape', () => {
    const current: OpenWebuiConfig = {
      default_models: ['old/model'],
      unrelated: 'keep',
    };

    const result = reconcileOpenwebuiManagedConfig(current, {
      defaultModels: ['synap/auto', 'synap/balanced'],
      webuiUrl: 'https://chat.example.com',
      webuiName: 'Eve Chat',
      enableSignup: false,
      defaultUserRole: 'user',
    });

    expect(result.config).toMatchObject({
      default_models: ['synap/auto', 'synap/balanced'],
      WEBUI_URL: 'https://chat.example.com',
      WEBUI_NAME: 'Eve Chat',
      ENABLE_SIGNUP: false,
      DEFAULT_USER_ROLE: 'user',
      unrelated: 'keep',
    });
    expect(result.config).not.toHaveProperty('DEFAULT_MODELS');
  });

  it('adds DEFAULT_MODELS when no default model key exists', () => {
    const result = reconcileOpenwebuiManagedConfig({}, {
      defaultModels: ['synap/auto', 'synap/balanced'],
    });

    expect(result.config.DEFAULT_MODELS).toBe('synap/auto,synap/balanced');
  });

  it('reports no change for already reconciled config', () => {
    const current: OpenWebuiConfig = {
      openai: {
        api_base_urls: ['http://synap/v1'],
        api_keys: ['synap-key'],
        metadata: {
          'http://synap/v1': { name: 'Synap IS', models: 'synap/auto' },
        },
      },
      DEFAULT_MODELS: 'synap/auto',
      WEBUI_NAME: 'Eve Chat',
    };

    const result = reconcileOpenwebuiManagedConfig(current, {
      modelSources: [{
        url: 'http://synap/v1',
        apiKey: 'synap-key',
        displayName: 'Synap IS',
        models: ['synap/auto'],
      }],
      defaultModels: 'synap/auto',
      webuiName: 'Eve Chat',
    });

    expect(result.changed).toBe(false);
    expect(result.changedKeys).toEqual([]);
  });
});

describe('reconcileOpenwebuiManagedConfigViaAdmin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips saving when the persisted config is already reconciled', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      WEBUI_NAME: 'Eve Chat',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await reconcileOpenwebuiManagedConfigViaAdmin('jwt', {
      webuiName: 'Eve Chat',
    });

    expect(result?.changed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('saves the merged config when managed fields change', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ userOwned: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await reconcileOpenwebuiManagedConfigViaAdmin('jwt', {
      webuiName: 'Eve Chat',
    });

    expect(result?.changed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const saveCall = fetchMock.mock.calls[1];
    // v0.9.4 import endpoint expects `{ config: <full snapshot> }`.
    expect(JSON.parse(String(saveCall[1]?.body))).toEqual({
      config: {
        userOwned: true,
        WEBUI_NAME: 'Eve Chat',
      },
    });
  });
});
