// @ts-nocheck
/**
 * A2A (Agent-to-Agent) Bridge for Hestia CLI
 * Enables OpenClaude and OpenClaw agents to communicate
 */
import * as EventEmitter from 'eventemitter3';
import { logger } from './logger.js';
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_CONFIG = {
    heartbeatInterval: 30000, // 30 seconds
    heartbeatTimeout: 60000, // 60 seconds
    maxRetries: 3,
    retryDelay: 1000,
    messageQueueSize: 1000,
};
// ============================================================================
// A2A Bridge Implementation
// ============================================================================
export class A2ABridge extends EventEmitter {
    agents = new Map();
    messageQueue = new Map();
    memoryStore = new Map();
    heartbeatTimers = new Map();
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        logger.debug('A2ABridge initialized', this.config);
    }
    // ==========================================================================
    // Agent Registry
    // ==========================================================================
    /**
     * Register a new agent in the bridge
     */
    registerAgent(agent) {
        if (this.agents.has(agent.id)) {
            const error = new Error(`Agent with id '${agent.id}' already registered`);
            error.code = 'AGENT_EXISTS';
            error.agentId = agent.id;
            throw error;
        }
        this.agents.set(agent.id, { ...agent, status: 'offline' });
        this.messageQueue.set(agent.id, []);
        logger.info(`Agent registered: ${agent.name} (${agent.id}) [${agent.type}]`);
        this.emit('agent:registered', agent);
        // Start heartbeat for this agent
        this.startHeartbeat(agent.id);
    }
    /**
     * Unregister an agent from the bridge
     */
    unregisterAgent(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            const error = new Error(`Agent with id '${agentId}' not found`);
            error.code = 'AGENT_NOT_FOUND';
            error.agentId = agentId;
            throw error;
        }
        // Stop heartbeat
        this.stopHeartbeat(agentId);
        // Clear queued messages
        this.messageQueue.delete(agentId);
        // Remove agent
        this.agents.delete(agentId);
        logger.info(`Agent unregistered: ${agent.name} (${agentId})`);
        this.emit('agent:unregistered', agent);
    }
    /**
     * Get a registered agent by ID
     */
    getAgent(agentId) {
        return this.agents.get(agentId);
    }
    /**
     * Get all registered agents
     */
    getAllAgents() {
        return Array.from(this.agents.values());
    }
    /**
     * Get agents by type
     */
    getAgentsByType(type) {
        return this.getAllAgents().filter(agent => agent.type === type);
    }
    /**
     * Get agents by status
     */
    getAgentsByStatus(status) {
        return this.getAllAgents().filter(agent => agent.status === status);
    }
    /**
     * Get agents by capability
     */
    getAgentsByCapability(capability) {
        return this.getAllAgents().filter(agent => agent.capabilities.includes(capability));
    }
    // ==========================================================================
    // Message Routing
    // ==========================================================================
    /**
     * Send a message to a specific agent
     */
    async send(from, to, action, payload, options = {}) {
        const message = this.createMessage(from, to, 'request', action, payload, options);
        return this.routeMessage(message);
    }
    /**
     * Send a response to a specific message
     */
    async respond(from, to, correlationId, action, payload, options = {}) {
        const message = this.createMessage(from, to, 'response', action, payload, {
            ...options,
            correlationId,
        });
        return this.routeMessage(message);
    }
    /**
     * Broadcast a message to all online agents
     */
    async broadcast(from, action, payload, options = {}) {
        const onlineAgents = this.getAgentsByStatus('online');
        const promises = onlineAgents
            .filter(agent => agent.id !== from)
            .map(agent => this.send(from, agent.id, action, payload, options));
        return Promise.all(promises);
    }
    /**
     * Emit an event to all subscribers
     */
    async emitEvent(from, action, payload, options = {}) {
        const message = this.createMessage(from, '*', 'event', action, payload, options);
        this.emit(`event:${action}`, message);
        this.emit('message:event', message);
        return message;
    }
    /**
     * Route a message to its destination
     */
    async routeMessage(message) {
        const targetAgent = this.agents.get(message.to);
        if (!targetAgent) {
            // Queue for offline agent if configured
            this.queueMessage(message);
            const error = new Error(`Agent '${message.to}' not available, message queued`);
            error.code = 'AGENT_OFFLINE';
            error.agentId = message.to;
            error.messageId = message.id;
            logger.warn(`Message ${message.id} queued for offline agent ${message.to}`);
            this.emit('message:queued', message);
            throw error;
        }
        if (targetAgent.status === 'offline') {
            this.queueMessage(message);
            const error = new Error(`Agent '${message.to}' is offline, message queued`);
            error.code = 'AGENT_OFFLINE';
            error.agentId = message.to;
            error.messageId = message.id;
            logger.warn(`Message ${message.id} queued for offline agent ${message.to}`);
            this.emit('message:queued', message);
            throw error;
        }
        try {
            await this.deliverMessage(targetAgent, message);
            this.emit('message:sent', message);
            return message;
        }
        catch (err) {
            this.queueMessage(message);
            throw err;
        }
    }
    /**
     * Deliver a message to an agent based on its type
     */
    async deliverMessage(agent, message) {
        logger.debug(`Delivering message ${message.id} to ${agent.name} (${agent.type})`);
        switch (agent.type) {
            case 'openclaude':
                await this.deliverToOpenClaude(agent, message);
                break;
            case 'openclaw':
                await this.deliverToOpenClaw(agent, message);
                break;
            case 'custom':
                await this.deliverToCustom(agent, message);
                break;
            default:
                throw new Error(`Unknown agent type: ${agent.type}`);
        }
    }
    /**
     * Deliver message to OpenClaude agent (gRPC or process)
     */
    async deliverToOpenClaude(agent, message) {
        // OpenClaude uses gRPC or can spawn as a process
        // For now, emit an event that the OpenClaude client can handle
        this.emit('deliver:openclaude', agent, message);
        // Simulate async delivery
        await new Promise((resolve) => setTimeout(resolve, 10));
        logger.debug(`Message delivered to OpenClaude agent: ${agent.id}`);
    }
    /**
     * Deliver message to OpenClaw agent (API or file-based)
     */
    async deliverToOpenClaw(agent, message) {
        // OpenClaw uses API calls or file-based communication
        this.emit('deliver:openclaw', agent, message);
        // Simulate async delivery
        await new Promise((resolve) => setTimeout(resolve, 10));
        logger.debug(`Message delivered to OpenClaw agent: ${agent.id}`);
    }
    /**
     * Deliver message to custom agent (HTTP/WebSocket)
     */
    async deliverToCustom(agent, message) {
        // Custom agents use generic HTTP/WebSocket
        this.emit('deliver:custom', agent, message);
        // Simulate async delivery
        await new Promise((resolve) => setTimeout(resolve, 10));
        logger.debug(`Message delivered to custom agent: ${agent.id}`);
    }
    // ==========================================================================
    // Message Queue
    // ==========================================================================
    /**
     * Queue a message for later delivery
     */
    queueMessage(message) {
        const queue = this.messageQueue.get(message.to) || [];
        if (queue.length >= this.config.messageQueueSize) {
            queue.shift(); // Remove oldest message
        }
        queue.push({
            message,
            retries: 0,
            queuedAt: new Date(),
        });
        this.messageQueue.set(message.to, queue);
        logger.debug(`Message ${message.id} queued for ${message.to}`);
    }
    /**
     * Process queued messages for an agent
     */
    async processQueue(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent || agent.status !== 'online') {
            return;
        }
        const queue = this.messageQueue.get(agentId) || [];
        if (queue.length === 0)
            return;
        logger.info(`Processing ${queue.length} queued messages for ${agent.name}`);
        const processed = [];
        const failed = [];
        for (const item of queue) {
            try {
                await this.deliverMessage(agent, item.message);
                processed.push(item);
                this.emit('message:delivered', item.message);
            }
            catch (err) {
                item.retries++;
                if (item.retries < this.config.maxRetries) {
                    failed.push(item);
                }
                else {
                    logger.error(`Message ${item.message.id} failed after ${this.config.maxRetries} retries`);
                    this.emit('message:failed', item.message, err);
                }
            }
        }
        // Update queue with failed items only
        this.messageQueue.set(agentId, failed);
        logger.info(`Processed ${processed.length} messages, ${failed.length} remaining in queue`);
    }
    /**
     * Get queued messages for an agent
     */
    getQueuedMessages(agentId) {
        return this.messageQueue.get(agentId) || [];
    }
    /**
     * Clear message queue for an agent
     */
    clearQueue(agentId) {
        this.messageQueue.set(agentId, []);
        logger.debug(`Cleared message queue for ${agentId}`);
    }
    // ==========================================================================
    // Shared Memory Store
    // ==========================================================================
    /**
     * Store a value in shared memory
     */
    setMemory(key, value, options = {}) {
        const existing = this.memoryStore.get(key);
        const now = new Date();
        const entry = {
            key,
            value,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            tags: options.tags,
            agentId: options.agentId,
        };
        this.memoryStore.set(key, entry);
        logger.debug(`Memory stored: ${key}`);
        this.emit('memory:set', entry);
        return entry;
    }
    /**
     * Retrieve a value from shared memory
     */
    getMemory(key) {
        const entry = this.memoryStore.get(key);
        return entry?.value;
    }
    /**
     * Get full memory entry including metadata
     */
    getMemoryEntry(key) {
        return this.memoryStore.get(key);
    }
    /**
     * Remove a value from shared memory
     */
    deleteMemory(key) {
        const existed = this.memoryStore.delete(key);
        if (existed) {
            logger.debug(`Memory deleted: ${key}`);
            this.emit('memory:delete', key);
        }
        return existed;
    }
    /**
     * Query shared memory with filters
     */
    queryMemory(query = {}) {
        let results = Array.from(this.memoryStore.values());
        if (query.tags && query.tags.length > 0) {
            results = results.filter(entry => entry.tags?.some(tag => query.tags.includes(tag)));
        }
        if (query.agentId) {
            results = results.filter(entry => entry.agentId === query.agentId);
        }
        if (query.keyPattern) {
            const pattern = new RegExp(query.keyPattern);
            results = results.filter(entry => pattern.test(entry.key));
        }
        if (query.since) {
            results = results.filter(entry => entry.updatedAt >= query.since);
        }
        // Sort by updatedAt desc
        results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        if (query.limit) {
            results = results.slice(0, query.limit);
        }
        return results;
    }
    /**
     * Get all memory keys
     */
    getMemoryKeys() {
        return Array.from(this.memoryStore.keys());
    }
    /**
     * Clear all memory
     */
    clearMemory() {
        this.memoryStore.clear();
        logger.info('Memory store cleared');
        this.emit('memory:clear');
    }
    // ==========================================================================
    // Heartbeat System
    // ==========================================================================
    /**
     * Start heartbeat monitoring for an agent
     */
    startHeartbeat(agentId) {
        this.stopHeartbeat(agentId);
        const timer = setInterval(() => {
            this.checkAgentHealth(agentId);
        }, this.config.heartbeatInterval);
        this.heartbeatTimers.set(agentId, timer);
    }
    /**
     * Stop heartbeat monitoring for an agent
     */
    stopHeartbeat(agentId) {
        const timer = this.heartbeatTimers.get(agentId);
        if (timer) {
            clearInterval(timer);
            this.heartbeatTimers.delete(agentId);
        }
    }
    /**
     * Check agent health based on last heartbeat
     */
    checkAgentHealth(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent)
            return;
        const now = new Date();
        const lastHeartbeat = agent.lastHeartbeat;
        if (!lastHeartbeat) {
            // Agent hasn't sent any heartbeat yet
            if (agent.status !== 'offline') {
                this.updateAgentStatus(agentId, 'offline');
            }
            return;
        }
        const elapsed = now.getTime() - lastHeartbeat.getTime();
        if (elapsed > this.config.heartbeatTimeout) {
            if (agent.status !== 'offline') {
                logger.warn(`Agent ${agent.name} (${agentId}) heartbeat timeout`);
                this.updateAgentStatus(agentId, 'offline');
            }
        }
    }
    /**
     * Update agent status and emit events
     */
    updateAgentStatus(agentId, status) {
        const agent = this.agents.get(agentId);
        if (!agent)
            return;
        const oldStatus = agent.status;
        agent.status = status;
        logger.info(`Agent ${agent.name} status: ${oldStatus} → ${status}`);
        this.emit('agent:status', agent, oldStatus);
        // If agent came online, process its queue
        if (oldStatus === 'offline' && status === 'online') {
            this.processQueue(agentId);
        }
    }
    /**
     * Record a heartbeat from an agent
     */
    heartbeat(agentId, metadata) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            logger.warn(`Heartbeat received from unknown agent: ${agentId}`);
            return;
        }
        const wasOffline = agent.status === 'offline';
        agent.lastHeartbeat = new Date();
        if (agent.status === 'offline' || agent.status === 'error') {
            this.updateAgentStatus(agentId, 'online');
        }
        logger.debug(`Heartbeat from ${agent.name}`, metadata);
        this.emit('agent:heartbeat', agent, metadata);
        // Process queue if agent just came online
        if (wasOffline) {
            this.processQueue(agentId);
        }
    }
    /**
     * Set agent status explicitly (e.g., when agent reports it's busy)
     */
    setAgentStatus(agentId, status) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`Agent not found: ${agentId}`);
        }
        if (agent.status !== status) {
            this.updateAgentStatus(agentId, status);
        }
    }
    // ==========================================================================
    // Event Subscription (inherited from EventEmitter3)
    // ==========================================================================
    /**
     * Subscribe to an event
     */
    on(event, handler) {
        return super.on(event, handler);
    }
    /**
     * Subscribe to an event once
     */
    once(event, handler) {
        return super.once(event, handler);
    }
    /**
     * Unsubscribe from an event
     */
    off(event, handler) {
        return super.off(event, handler);
    }
    // ==========================================================================
    // Utilities
    // ==========================================================================
    /**
     * Create a message object
     */
    createMessage(from, to, type, action, payload, options = {}) {
        return {
            id: this.generateId(),
            from,
            to,
            type,
            action,
            payload,
            timestamp: new Date(),
            correlationId: options.correlationId,
            ttl: options.ttl,
            priority: options.priority || 'normal',
        };
    }
    /**
     * Generate a unique ID
     */
    generateId() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * Get bridge statistics
     */
    getStats() {
        return {
            agents: this.agents.size,
            onlineAgents: this.getAgentsByStatus('online').length,
            totalQueuedMessages: Array.from(this.messageQueue.values())
                .reduce((sum, queue) => sum + queue.length, 0),
            memoryEntries: this.memoryStore.size,
        };
    }
    /**
     * Dispose of the bridge and clean up resources
     */
    dispose() {
        // Stop all heartbeats
        for (const [agentId] of this.heartbeatTimers) {
            this.stopHeartbeat(agentId);
        }
        // Clear all data
        this.agents.clear();
        this.messageQueue.clear();
        this.memoryStore.clear();
        // Remove all listeners
        this.removeAllListeners();
        logger.info('A2ABridge disposed');
    }
}
// ============================================================================
// Singleton Export
// ============================================================================
export const a2aBridge = new A2ABridge();
// ============================================================================
// Default Export
// ============================================================================
export default A2ABridge;
//# sourceMappingURL=a2a-bridge.js.map