/**
 * `refreshTraefikRoutes` — what every route regeneration goes through
 * (`traefik-routes` materializer: eve add/remove, eve domain set|apply|repair,
 * and every component update).
 *
 * It generates routes for the INSTALLED components only, and an unreadable
 * state file must not read as "nothing installed": that rewrote the routes
 * with no component in them, i.e. took every route on the pod down.
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
  beforeEach(() => {
    getInstalledComponents.mockReset();
    configure = vi
      .spyOn(TraefikService.prototype, 'configureSubdomains')
      .mockResolvedValue({ changed: true });
  });
  afterEach(() => configure.mockRestore());

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
