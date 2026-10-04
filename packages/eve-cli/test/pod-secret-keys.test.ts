import { describe, expect, it } from 'vitest';
import { POD_SECRET_KEYS } from '@eve/brain';

/**
 * Every pod env key that ENCRYPTS DATA AT REST must be mirrored: losing one makes
 * restored data permanently unreadable. Derived 2026-10-04 from synap-backend
 * (`process.env.*` matching ENCRYPTION|CIPHER|VAULT|SERVER_KEY|MASTER in
 * packages/ + apps/): exactly these two. This test cannot see a NEW at-rest key
 * added in synap-backend — re-run that derivation when adding one.
 */
const AT_REST_KEYS = ['SYNAP_SERVICE_ENCRYPTION_KEY', 'VAULT_SERVER_KEY'] as const;

describe('pod secrets mirror', () => {
  it.each(AT_REST_KEYS)('mirrors at-rest encryption key %s', (key) => {
    expect(POD_SECRET_KEYS).toContain(key);
  });
});
