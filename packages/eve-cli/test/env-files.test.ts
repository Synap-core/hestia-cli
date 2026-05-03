import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvVar, readEnvFile, writeEnvVar } from '@eve/lifecycle';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'eve-env-files-'));
}

describe('@eve/lifecycle env-files', () => {
  it('readEnvVar returns null when file is missing', () => {
    const dir = tmp();
    try {
      expect(readEnvVar(dir, 'FOO')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readEnvVar returns null when key is absent', () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, '.env'), 'OTHER=bar\n');
      expect(readEnvVar(dir, 'FOO')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readEnvVar honors last occurrence on duplicates', () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, '.env'), 'FOO=first\nFOO=last\n');
      expect(readEnvVar(dir, 'FOO')).toBe('last');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readEnvFile returns ordered map', () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, '.env'), '# header\nA=1\nB=2\n# mid\nC=3\n');
      const m = readEnvFile(dir);
      expect([...m.keys()]).toEqual(['A', 'B', 'C']);
      expect(m.get('B')).toBe('2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeEnvVar creates missing file with key', () => {
    const dir = tmp();
    try {
      const r = writeEnvVar(dir, 'FOO', 'bar');
      expect(r.changed).toBe(true);
      expect(r.previous).toBeNull();
      expect(readFileSync(join(dir, '.env'), 'utf-8')).toBe('FOO=bar\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeEnvVar is idempotent on identical value', () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, '.env'), 'FOO=bar\n');
      const r = writeEnvVar(dir, 'FOO', 'bar');
      expect(r.changed).toBe(false);
      expect(r.previous).toBe('bar');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeEnvVar updates existing value in place and drops duplicates', () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, '.env'), '# top\nFOO=old\nOTHER=z\nFOO=stale-dup\n');
      const r = writeEnvVar(dir, 'FOO', 'new');
      expect(r.changed).toBe(true);
      expect(r.previous).toBe('old');
      const out = readFileSync(join(dir, '.env'), 'utf-8');
      expect(out).toContain('FOO=new');
      expect(out).not.toContain('FOO=old');
      expect(out).not.toContain('FOO=stale-dup');
      expect(out).toContain('OTHER=z');
      expect(out).toContain('# top');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeEnvVar removes the key when value is null', () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, '.env'), 'A=1\nFOO=bar\nB=2\n');
      const r = writeEnvVar(dir, 'FOO', null);
      expect(r.changed).toBe(true);
      expect(r.previous).toBe('bar');
      const out = readFileSync(join(dir, '.env'), 'utf-8');
      expect(out).not.toContain('FOO=');
      expect(out).toContain('A=1');
      expect(out).toContain('B=2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeEnvVar refuses invalid keys', () => {
    const dir = tmp();
    try {
      expect(() => writeEnvVar(dir, '1BAD', 'v')).toThrow();
      expect(() => writeEnvVar(dir, 'WITH SPACE', 'v')).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
