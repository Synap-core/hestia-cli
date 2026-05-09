import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMPONENTS,
  appendOperationalEvent,
  readOperationalEvents,
  redactSecrets,
} from '../src/index.js';

describe('operational events', () => {
  let stateHome: string;

  beforeEach(() => {
    stateHome = mkdtempSync(join(tmpdir(), 'eve-events-'));
  });

  afterEach(() => {
    rmSync(stateHome, { recursive: true, force: true });
  });

  it('appends and reads JSONL records in order', async () => {
    await appendOperationalEvent({ type: 'config.changed', target: 'domain', summary: 'one' }, stateHome);
    await appendOperationalEvent({ type: 'materialize.failed', target: 'traefik-routes', ok: false, error: 'boom' }, stateHome);

    const events = await readOperationalEvents({ stateHome });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'config.changed', target: 'domain', summary: 'one' });
    expect(events[1]).toMatchObject({ type: 'materialize.failed', target: 'traefik-routes', ok: false, error: 'boom' });
    expect(events[0]?.id).toBeTruthy();
    expect(events[0]?.timestamp).toBeTruthy();
  });

  it('limits recent event reads', async () => {
    await appendOperationalEvent({ type: 'config.changed', target: 'one' }, stateHome);
    await appendOperationalEvent({ type: 'config.changed', target: 'two' }, stateHome);

    const events = await readOperationalEvents({ stateHome, limit: 1 });

    expect(events.map((event) => event.target)).toEqual(['two']);
  });
});

describe('operational metadata', () => {
  it('declares materializers through component metadata', () => {
    const synap = COMPONENTS.find((component) => component.id === 'synap');
    const traefik = COMPONENTS.find((component) => component.id === 'traefik');

    expect(synap?.materializers).toContain('backend-env');
    expect(synap?.materializers).toContain('ai-wiring');
    expect(traefik?.materializers).toContain('traefik-routes');
    expect(synap?.doctor?.critical).toBe(true);
  });
});

describe('debug redaction', () => {
  it('redacts secret-like fields recursively', () => {
    const redacted = redactSecrets({
      apiKey: 'sk-1234567890',
      nested: {
        userToken: 'token-abcdef',
        publicUrl: 'https://pod.example.com',
      },
    });

    expect(redacted.apiKey).toBe('sk-***890');
    expect(redacted.nested.userToken).toBe('tok***def');
    expect(redacted.nested.publicUrl).toBe('https://pod.example.com');
  });
});
