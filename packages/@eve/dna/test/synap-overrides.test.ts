import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { ensureSynapLoopbackOverride } from '../src/synap-overrides.js';

interface ServiceNetworks {
  networks?: Record<string, { aliases?: string[] } | null>;
}
interface Override {
  networks: Record<string, { external?: boolean }>;
  services: Record<string, ServiceNetworks>;
}

describe('ensureSynapLoopbackOverride', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eve-override-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const read = () => yaml.load(readFileSync(join(dir, 'docker-compose.override.yml'), 'utf-8')) as Override;

  it('puts minio on eve-network under a stable alias, keeping synap-net', () => {
    expect(ensureSynapLoopbackOverride(dir).outcome).toBe('wrote');
    const override = read();
    expect(override.networks['eve-network']?.external).toBe(true);
    const minio = override.services.minio?.networks ?? {};
    // Traefik routes pod.<domain>/synap-storage/* to minio by name: without
    // eve-network every signed file link fails once minio is recreated.
    expect(minio['eve-network']?.aliases).toEqual(['eve-brain-minio']);
    // map form so Compose MERGES with the base file's synap-net, never replaces it
    expect(Object.keys(minio)).toContain('synap-net');
  });

  it('keeps backend, pod-admin and realtime on eve-network', () => {
    ensureSynapLoopbackOverride(dir);
    const { services } = read();
    expect(services.backend?.networks?.['eve-network']?.aliases).toEqual(['eve-brain-synap']);
    expect(services['pod-admin']?.networks?.['eve-network']?.aliases).toEqual(['eve-brain-pod-admin']);
    expect(services.realtime?.networks?.['eve-network']?.aliases).toEqual(['eve-brain-realtime']);
  });

  it('refreshes a v3 override (the one without minio) on upgrade', () => {
    const path = join(dir, 'docker-compose.override.yml');
    writeFileSync(path, '# Marker: eve-managed:synap-loopback-override:v3\nservices: {}\n', 'utf-8');
    expect(ensureSynapLoopbackOverride(dir).outcome).toBe('wrote');
    expect(readFileSync(path, 'utf-8')).toContain('eve-managed:synap-loopback-override:v4');
    expect(read().services.minio).toBeDefined();
  });

  it('leaves a user-owned override alone', () => {
    const path = join(dir, 'docker-compose.override.yml');
    writeFileSync(path, 'services: {}\n', 'utf-8');
    expect(ensureSynapLoopbackOverride(dir).outcome).toBe('kept');
    expect(readFileSync(path, 'utf-8')).toBe('services: {}\n');
  });
});
