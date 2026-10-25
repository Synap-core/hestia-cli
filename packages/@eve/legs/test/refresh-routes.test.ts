/**
 * `refreshTraefikRoutes` — what every route regeneration goes through
 * (`traefik-routes` materializer: eve add/remove, eve domain set|apply|repair,
 * and every component update).
 *
 * It generates routes for the INSTALLED components only, and an unreadable
 * state file must not read as "nothing installed": that rewrote the routes
 * with no component in them, i.e. took every route on the pod down.
 *
 * Eve's settings come from EVE_HOME, else the current directory, and a host
 * can hold two `.eve/` homes on different domains (CT101). Regenerating from
 * the wrong one would move every route of the pod to a domain nobody points at
 * it, so live routes generated for another domain are left alone unless the
 * caller is changing the domain on purpose.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { TraefikService } from '../src/lib/traefik';
import { refreshTraefikRoutes } from '../src/lib/refresh-routes';

const { getInstalledComponents } = vi.hoisted(() => ({
  getInstalledComponents: vi.fn<[], Promise<string[]>>(),
}));

vi.mock('@eve/dna', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@eve/dna')>()),
  readEveSecrets: vi.fn(async () => ({ domain: { primary: 'example.com', ssl: true } })),
  entityStateManager: { getInstalledComponents },
}));

describe('refreshTraefikRoutes', () => {
  let configure: MockInstance;
  let live: MockInstance;
  beforeEach(() => {
    getInstalledComponents.mockReset();
    getInstalledComponents.mockResolvedValue(['traefik', 'synap']);
    configure = vi
      .spyOn(TraefikService.prototype, 'configureSubdomains')
      .mockResolvedValue({ changed: true });
    live = vi.spyOn(TraefikService.prototype, 'readRoutesDomain').mockReturnValue({ state: 'missing' });
  });
  afterEach(() => {
    configure.mockRestore();
    live.mockRestore();
  });

  const servedBy = (domain: string) =>
    ({ state: 'found', domain, path: '/opt/traefik/dynamic/eve-routes.yml' }) as const;

  it('leaves routes generated for another domain alone, naming both domains and the settings read', async () => {
    live.mockReturnValue(servedBy('antoinesrvt.synap.live'));

    const result = await refreshTraefikRoutes();

    expect(configure).not.toHaveBeenCalled();
    expect(result.refreshed).toBe(false);
    expect(result.refusal).toBe('domain-mismatch');
    expect(result.reason).toContain('serves antoinesrvt.synap.live');
    expect(result.reason).toContain('say example.com');
    expect(result.reason).toContain('.eve/secrets/secrets.json');
    expect(result.reason).toContain('EVE_HOME');
  });

  it('replaces them when the caller is changing the domain on purpose', async () => {
    live.mockReturnValue(servedBy('antoinesrvt.synap.live'));

    const result = await refreshTraefikRoutes(undefined, { allowDomainChange: true });

    expect(configure).toHaveBeenCalledTimes(1);
    expect(result.refreshed).toBe(true);
  });

  it('regenerates routes already generated for the same domain (case-insensitive)', async () => {
    live.mockReturnValue(servedBy('Example.COM'));

    const result = await refreshTraefikRoutes();

    expect(configure).toHaveBeenCalledTimes(1);
    expect(result.refreshed).toBe(true);
  });

  it('leaves the routes alone when the current routes file cannot be read', async () => {
    live.mockReturnValue({ state: 'unreadable', error: 'EACCES' });

    const result = await refreshTraefikRoutes();

    expect(configure).not.toHaveBeenCalled();
    expect(result.refusal).toBe('routes-unreadable');
  });

  it('generates the routes for the installed components, with the saved domain', async () => {
    getInstalledComponents.mockResolvedValue(['traefik', 'synap', 'openwebui']);

    const result = await refreshTraefikRoutes();

    expect(result).toEqual({ refreshed: true, domain: 'example.com', changed: true });
    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure.mock.calls[0][0]).toBe('example.com');
    expect(configure.mock.calls[0][3]).toEqual(['traefik', 'synap', 'openwebui']);
  });

  it('leaves the routes alone when the installed components cannot be read', async () => {
    getInstalledComponents.mockRejectedValue(new Error('Invalid state JSON: Unexpected token'));

    const result = await refreshTraefikRoutes();

    expect(configure).not.toHaveBeenCalled();
    expect(result.refreshed).toBe(false);
    expect(result.reason).toContain('installed components unreadable');
  });
});
