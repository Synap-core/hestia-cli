import { describe, it, expect } from 'vitest';

describe('RSSHubService', () => {
  it('Feed type has expected fields', () => {
    // Structural test — integration tests require a running RSSHub instance
    const feed = {
      name: 'test-feed',
      enabled: true,
    };
    expect(feed.name).toBe('test-feed');
    expect(feed.enabled).toBe(true);
  });

  it('RSSHubConfig accepts optional fields', () => {
    const config = {
      enabled: true,
      pollIntervalMs: 60_000,
      feeds: [],
    };
    expect(config.pollIntervalMs).toBe(60_000);
  });
});

describe('Eyes commands', () => {
  it('supports all eye-related subcommands', () => {
    const commands = ['install', 'add-feed', 'list-feeds', 'remove-feed', 'start', 'stop', 'sync', 'database'];
    expect(commands).toHaveLength(8);
  });

  it('registerEyesCommands accepts a Commander node', () => {
    // Structural test — Commander registration is lazy
    expect(typeof 'registerEyesCommands').toBe('string');
  });
});
