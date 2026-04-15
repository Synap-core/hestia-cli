import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const bin = join(root, '..', 'dist', 'index.js');

describe('eve CLI', () => {
  it('prints help', () => {
    const out = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf-8' });
    expect(out).toContain('Eve');
    expect(out).toContain('brain');
  });

  it('brain --help', () => {
    const out = execFileSync(process.execPath, [bin, 'brain', '--help'], { encoding: 'utf-8' });
    expect(out).toContain('init');
  });

  it('setup --help lists profiles', () => {
    const out = execFileSync(process.execPath, [bin, 'setup', '--help'], { encoding: 'utf-8' });
    expect(out).toContain('inference_only');
    expect(out).toContain('data_pod');
  });

  it('setup --dry-run does not write .eve in cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eve-setup-'));
    try {
      const out = execFileSync(process.execPath, [bin, 'setup', '--dry-run', '--profile', 'full'], {
        cwd: dir,
        encoding: 'utf-8',
      });
      expect(out).toContain('"profile": "full"');
      expect(out).toContain('"tunnel"');
      expect(existsSync(join(dir, '.eve', 'setup-profile.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('setup --dry-run --json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eve-setup-json-'));
    try {
      const out = execFileSync(
        process.execPath,
        [bin, '--json', 'setup', '--dry-run', '--profile', 'data_pod'],
        { cwd: dir, encoding: 'utf-8' },
      );
      const j = JSON.parse(out.trim()) as { profile?: string };
      expect(j.profile).toBe('data_pod');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builder stack --help', () => {
    const out = execFileSync(process.execPath, [bin, 'builder', 'stack', '--help'], { encoding: 'utf-8' });
    expect(out).toContain('up');
  });
});
