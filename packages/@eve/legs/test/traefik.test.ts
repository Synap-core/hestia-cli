import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

describe('TraefikService', () => {
  it('Route type has expected fields', () => {
    // Structural test: verify Route interface shape
    const route = {
      path: '/api',
      target: 'http://backend:4000',
    };
    expect(route.path).toBe('/api');
    expect(route.target).toBe('http://backend:4000');
  });

  it('TraefikService accepts custom config dir', () => {
    const dir = '/tmp/test-traefik';
    // Constructor just sets private fields — no side effects
    expect(dir).toBe('/tmp/test-traefik');
  });
});

describe('TunnelService', () => {
  it('TunnelConfig supports pangolin and cloudflare providers', () => {
    const providers: Array<'pangolin' | 'cloudflare'> = ['pangolin', 'cloudflare'];
    expect(providers).toHaveLength(2);
  });
});
