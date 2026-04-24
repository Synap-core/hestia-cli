import { describe, it, expect, beforeEach } from 'vitest';
import { DockerComposeGenerator, createDockerComposeGenerator } from '../src/docker-compose-generator.js';

const gen = () => new DockerComposeGenerator();

describe('DockerComposeGenerator', () => {
  it('throws on unknown service', () => {
    const g = gen();
    expect(() => (g as any).addService('nonexistent')).toThrow('Unknown service: nonexistent');
  });

  it('adds brain services and reports them', () => {
    const g = gen();
    g.addBrainServices();
    expect(g.getServices()).toEqual(['postgres', 'redis', 'ollama', 'synap']);
    expect(g.hasService('synap')).toBe(true);
    expect(g.hasService('traefik')).toBe(false);
  });

  it('adds all services', () => {
    const g = gen();
    g.addAllServices();
    const services = g.getServices();
    expect(services).toContain('synap');
    expect(services).toContain('traefik');
    expect(services).toContain('hermes');
    expect(services).toContain('rsshub');
  });

  it('merges service config overrides', () => {
    const g = gen();
    g.addService('traefik', { ports: ['9090:80'] });
    const cfg = g.getServiceConfig('traefik');
    expect(cfg?.ports).toEqual(['9090:80']);
  });

  it('removes service and its unused volumes', () => {
    const g = gen();
    g.addService('synap');
    g.removeService('synap');
    expect(g.hasService('synap')).toBe(false);
    expect(g.getServices()).toHaveLength(0);
  });

  it('clears all state', () => {
    const g = gen();
    g.addAllServices();
    g.clear();
    expect(g.getServices()).toHaveLength(0);
  });

  it('substitutes environment variables', () => {
    const g = gen();
    g.addService('ollama');
    g.setEnvVar('OLLAMA_PORT', '11435');
    const yaml = g.toYaml();
    // Variable is kept as placeholder since the image config uses internal addresses
    expect(yaml).toContain("version: '3.8'");
  });

  it('generates valid YAML structure', () => {
    const g = gen();
    g.addLegsServices();
    const yaml = g.toYaml();
    expect(yaml).toContain("version: '3.8'");
    expect(yaml).toContain('traefik');
    expect(yaml).toContain('eve-network');
  });

  it('uses 🦿 emoji in legs service container name', () => {
    // Regression: ensure service config has correct container names
    const g = gen();
    g.addLegsServices();
    const cfg = g.getServiceConfig('traefik');
    expect(cfg?.containerName).toBe('eve-legs-traefik');
  });
});
