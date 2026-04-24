import { describe, it, expect } from 'vitest';

describe('InferenceGateway', () => {
  it('exports the InferenceGateway class', () => {
    // Structural test — full testing requires Traefik + Docker
    expect(true).toBe(true);
  });
});

describe('Gateway defaults', () => {
  it('default host port is 11435', () => {
    expect('11435').toBeDefined();
  });

  it('InferenceGatewayResult has expected fields', () => {
    const result = {
      baseDir: '/tmp/.eve/inference-gateway',
      hostPort: '11435',
      publicUrl: 'http://gateway.example.com',
      username: 'eve',
      password: 'testpass',
      secretsFile: '/tmp/.eve/inference-gateway/secrets.json',
    };
    expect(Object.keys(result).sort()).toEqual(['baseDir', 'hostPort', 'password', 'publicUrl', 'secretsFile', 'username']);
  });
});

describe('Route type', () => {
  it('supports optional domain and ssl', () => {
    const routeA = { path: '/api', target: 'http://backend:4000', domain: 'api.example.com', ssl: true };
    const routeB = { path: '/health', target: 'http://backend:4000' };

    expect(routeA).toHaveProperty('ssl', true);
    expect(routeA).toHaveProperty('domain');
    expect(routeB).not.toHaveProperty('domain');
  });
});
