import { describe, expect, it } from 'vitest';
import {
  createAllowedEmbedOriginChecker,
  isAllowedEmbedOrigin,
} from '../src/allowed-origins.js';

describe('isAllowedEmbedOrigin', () => {
  it('keeps localhost origins allowed by default', () => {
    expect(isAllowedEmbedOrigin('http://localhost')).toBe(true);
    expect(isAllowedEmbedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedEmbedOrigin('https://localhost:8443')).toBe(true);
  });

  it('keeps https synap.live subdomains allowed by default', () => {
    expect(isAllowedEmbedOrigin('https://app.synap.live')).toBe(true);
    expect(isAllowedEmbedOrigin('https://pod-123.synap.live')).toBe(true);
  });

  it('continues to reject unknown origins by default', () => {
    expect(isAllowedEmbedOrigin('https://example.com')).toBe(false);
    expect(isAllowedEmbedOrigin('http://app.synap.live')).toBe(false);
    expect(isAllowedEmbedOrigin('https://synap.live')).toBe(false);
    expect(isAllowedEmbedOrigin('https://app.synap.live:443')).toBe(false);
  });

  it('accepts exact runtime manifest origins', () => {
    const runtimeOrigins = [
      'https://workspace.example.com',
      new URL('https://tools.example.com/app/openclaw'),
    ];

    expect(isAllowedEmbedOrigin('https://workspace.example.com', runtimeOrigins)).toBe(true);
    expect(isAllowedEmbedOrigin('https://tools.example.com', runtimeOrigins)).toBe(true);
  });

  it('does not treat runtime manifest origins as wildcard host grants', () => {
    const runtimeOrigins = ['https://workspace.example.com'];

    expect(isAllowedEmbedOrigin('https://other.workspace.example.com', runtimeOrigins)).toBe(false);
    expect(isAllowedEmbedOrigin('https://workspace.example.com.evil.test', runtimeOrigins)).toBe(false);
  });

  it('ignores invalid and opaque runtime manifest entries', () => {
    const runtimeOrigins = ['*', 'not a url', 'file:///tmp/app.html'];

    expect(isAllowedEmbedOrigin('null', runtimeOrigins)).toBe(false);
    expect(isAllowedEmbedOrigin('https://example.com', runtimeOrigins)).toBe(false);
  });
});

describe('createAllowedEmbedOriginChecker', () => {
  it('precomputes a checker with defaults and runtime manifest origins', () => {
    const isAllowed = createAllowedEmbedOriginChecker([
      'https://runtime.example.com/app',
    ]);

    expect(isAllowed('http://localhost:3000')).toBe(true);
    expect(isAllowed('https://app.synap.live')).toBe(true);
    expect(isAllowed('https://runtime.example.com')).toBe(true);
    expect(isAllowed('https://other.example.com')).toBe(false);
  });
});
