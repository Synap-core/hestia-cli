import { Command } from 'commander';

interface Feed {
    name: string;
    url: string;
    lastFetch?: Date;
    status: 'active' | 'paused' | 'error';
}
interface RSSHubConfig {
    port: number;
}
declare class RSSHubService {
    private config;
    private feeds;
    constructor(config?: Partial<RSSHubConfig>);
    /**
     * Check if RSSHub is installed
     */
    isInstalled(): Promise<boolean>;
    /**
     * Check if RSSHub container is running
     */
    isRunning(): Promise<boolean>;
    /**
     * Install RSSHub container
     */
    install(config?: Partial<RSSHubConfig>): Promise<void>;
    /**
     * Start RSSHub container
     */
    start(): Promise<void>;
    /**
     * Stop RSSHub container
     */
    stop(): Promise<void>;
    /**
     * Add a feed
     */
    addFeed(name: string, url: string): Promise<void>;
    /**
     * List all feeds
     */
    listFeeds(): Promise<Feed[]>;
    /**
     * Remove a feed
     */
    removeFeed(name: string): Promise<void>;
    /**
     * Sync feeds to Brain
     */
    syncToBrain(): Promise<void>;
}

declare function installCommand(program: Command): void;

declare function addFeedCommand(program: Command): void;

declare function listFeedsCommand(program: Command): void;

declare function removeFeedCommand(program: Command): void;

declare function startCommand(program: Command): void;

declare function stopCommand(program: Command): void;

declare function syncCommand(program: Command): void;

/**
 * Register Eyes leaf commands on an existing `eve eyes` Commander node
 */
declare function registerEyesCommands(eyes: Command): void;
/**
 * Create an RSSHub service instance
 */
declare function createRSSHubService(config?: ConstructorParameters<typeof RSSHubService>[0]): RSSHubService;

export { type Feed, type RSSHubConfig, RSSHubService, addFeedCommand, createRSSHubService, installCommand, listFeedsCommand, registerEyesCommands, removeFeedCommand, startCommand, stopCommand, syncCommand };
