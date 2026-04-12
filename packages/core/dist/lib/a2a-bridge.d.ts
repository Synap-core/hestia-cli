/**
 * A2A (Agent-to-Agent) Bridge for Hestia CLI
 * Enables OpenClaude and OpenClaw agents to communicate
 */
import * as EventEmitter from 'eventemitter3';
export type AgentType = 'openclaude' | 'openclaw' | 'custom';
export type AgentStatus = 'online' | 'offline' | 'busy' | 'error';
export type MessageType = 'request' | 'response' | 'event';
export interface Agent {
    id: string;
    name: string;
    type: AgentType;
    endpoint: string;
    capabilities: string[];
    status: AgentStatus;
    lastHeartbeat?: Date;
    metadata?: Record<string, unknown>;
}
export interface A2AMessage {
    id: string;
    from: string;
    to: string;
    type: MessageType;
    action: string;
    payload: unknown;
    timestamp: Date;
    correlationId?: string;
    ttl?: number;
    priority?: 'low' | 'normal' | 'high' | 'critical';
}
export interface A2AMessageOptions {
    ttl?: number;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    correlationId?: string;
}
export interface QueuedMessage {
    message: A2AMessage;
    retries: number;
    queuedAt: Date;
}
export interface MemoryEntry {
    key: string;
    value: unknown;
    createdAt: Date;
    updatedAt: Date;
    tags?: string[];
    agentId?: string;
}
export interface MemoryQuery {
    tags?: string[];
    agentId?: string;
    keyPattern?: string;
    since?: Date;
    limit?: number;
}
export interface BridgeConfig {
    heartbeatInterval?: number;
    heartbeatTimeout?: number;
    maxRetries?: number;
    retryDelay?: number;
    messageQueueSize?: number;
}
export interface A2AError extends Error {
    code: string;
    agentId?: string;
    messageId?: string;
}
export declare class A2ABridge extends EventEmitter {
    private agents;
    private messageQueue;
    private memoryStore;
    private heartbeatTimers;
    private config;
    constructor(config?: BridgeConfig);
    /**
     * Register a new agent in the bridge
     */
    registerAgent(agent: Agent): void;
    /**
     * Unregister an agent from the bridge
     */
    unregisterAgent(agentId: string): void;
    /**
     * Get a registered agent by ID
     */
    getAgent(agentId: string): Agent | undefined;
    /**
     * Get all registered agents
     */
    getAllAgents(): Agent[];
    /**
     * Get agents by type
     */
    getAgentsByType(type: AgentType): Agent[];
    /**
     * Get agents by status
     */
    getAgentsByStatus(status: AgentStatus): Agent[];
    /**
     * Get agents by capability
     */
    getAgentsByCapability(capability: string): Agent[];
    /**
     * Send a message to a specific agent
     */
    send(from: string, to: string, action: string, payload: unknown, options?: A2AMessageOptions): Promise<A2AMessage>;
    /**
     * Send a response to a specific message
     */
    respond(from: string, to: string, correlationId: string, action: string, payload: unknown, options?: A2AMessageOptions): Promise<A2AMessage>;
    /**
     * Broadcast a message to all online agents
     */
    broadcast(from: string, action: string, payload: unknown, options?: A2AMessageOptions): Promise<A2AMessage[]>;
    /**
     * Emit an event to all subscribers
     */
    emitEvent(from: string, action: string, payload: unknown, options?: A2AMessageOptions): Promise<A2AMessage>;
    /**
     * Route a message to its destination
     */
    private routeMessage;
    /**
     * Deliver a message to an agent based on its type
     */
    private deliverMessage;
    /**
     * Deliver message to OpenClaude agent (gRPC or process)
     */
    private deliverToOpenClaude;
    /**
     * Deliver message to OpenClaw agent (API or file-based)
     */
    private deliverToOpenClaw;
    /**
     * Deliver message to custom agent (HTTP/WebSocket)
     */
    private deliverToCustom;
    /**
     * Queue a message for later delivery
     */
    private queueMessage;
    /**
     * Process queued messages for an agent
     */
    processQueue(agentId: string): Promise<void>;
    /**
     * Get queued messages for an agent
     */
    getQueuedMessages(agentId: string): QueuedMessage[];
    /**
     * Clear message queue for an agent
     */
    clearQueue(agentId: string): void;
    /**
     * Store a value in shared memory
     */
    setMemory(key: string, value: unknown, options?: {
        tags?: string[];
        agentId?: string;
    }): MemoryEntry;
    /**
     * Retrieve a value from shared memory
     */
    getMemory(key: string): unknown | undefined;
    /**
     * Get full memory entry including metadata
     */
    getMemoryEntry(key: string): MemoryEntry | undefined;
    /**
     * Remove a value from shared memory
     */
    deleteMemory(key: string): boolean;
    /**
     * Query shared memory with filters
     */
    queryMemory(query?: MemoryQuery): MemoryEntry[];
    /**
     * Get all memory keys
     */
    getMemoryKeys(): string[];
    /**
     * Clear all memory
     */
    clearMemory(): void;
    /**
     * Start heartbeat monitoring for an agent
     */
    private startHeartbeat;
    /**
     * Stop heartbeat monitoring for an agent
     */
    private stopHeartbeat;
    /**
     * Check agent health based on last heartbeat
     */
    private checkAgentHealth;
    /**
     * Update agent status and emit events
     */
    private updateAgentStatus;
    /**
     * Record a heartbeat from an agent
     */
    heartbeat(agentId: string, metadata?: Record<string, unknown>): void;
    /**
     * Set agent status explicitly (e.g., when agent reports it's busy)
     */
    setAgentStatus(agentId: string, status: AgentStatus): void;
    /**
     * Subscribe to an event
     */
    on<T = unknown>(event: string, handler: (data: T) => void): this;
    /**
     * Subscribe to an event once
     */
    once<T = unknown>(event: string, handler: (data: T) => void): this;
    /**
     * Unsubscribe from an event
     */
    off<T = unknown>(event: string, handler: (data: T) => void): this;
    /**
     * Create a message object
     */
    private createMessage;
    /**
     * Generate a unique ID
     */
    private generateId;
    /**
     * Get bridge statistics
     */
    getStats(): {
        agents: number;
        onlineAgents: number;
        totalQueuedMessages: number;
        memoryEntries: number;
    };
    /**
     * Dispose of the bridge and clean up resources
     */
    dispose(): void;
}
export declare const a2aBridge: A2ABridge;
export default A2ABridge;
//# sourceMappingURL=a2a-bridge.d.ts.map