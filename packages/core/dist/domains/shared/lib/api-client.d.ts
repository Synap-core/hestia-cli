/**
 * Hestia CLI - API Client
 *
 * Uses standard Synap Hub Protocol APIs for infrastructure management.
 * All operations go through generic entity endpoints.
 */
import type { HearthNode, PackageInstance, IntelligenceProvider, Deployment, ChatCompletionRequest, ChatCompletionResponse, RegisterHearthConfig, HeartbeatData } from '../../lib/types/index';
interface APIClientConfig {
    baseUrl: string;
    apiKey: string;
    workspaceId: string;
    timeout?: number;
}
export declare class APIClient {
    private config;
    constructor(config: APIClientConfig);
    private request;
    /**
     * Create an entity using the standard Synap entities.create endpoint.
     * All Hestia infrastructure components are stored as entities.
     */
    createEntity(params: {
        profileSlug: string;
        title: string;
        properties?: Record<string, unknown>;
    }): Promise<{
        id: string;
        success: boolean;
    }>;
    /**
     * Update an entity using the standard Synap entities.update endpoint.
     */
    updateEntity(entityId: string, properties: Record<string, unknown>): Promise<boolean>;
    /**
     * List entities using the standard Synap entities.list endpoint.
     */
    listEntities(profileSlug: string): Promise<Array<{
        id: string;
        properties?: Record<string, unknown>;
    }>>;
    /**
     * Get a single entity using the standard Synap entities.get endpoint.
     */
    getEntity(entityId: string): Promise<{
        id: string;
        properties?: Record<string, unknown>;
    } | null>;
    /**
     * Register a new hearth node.
     * Creates two entities: intelligence_provider and hearth_node (linked).
     */
    registerHearth(config: RegisterHearthConfig): Promise<{
        hearth_node: HearthNode;
        intelligence_provider: IntelligenceProvider;
    }>;
    /**
     * Send heartbeat for a hearth node.
     * Updates the hearth_node entity and creates/updates package_instance entities.
     */
    heartbeat(hearthNodeId: string, data: HeartbeatData): Promise<void>;
    /**
     * Get hearth node status with packages and provider.
     */
    getHearthStatus(hearthNodeId: string): Promise<{
        hearth_node: HearthNode;
        packages: PackageInstance[];
        intelligence_provider?: IntelligenceProvider;
    }>;
    /**
     * List all hearth nodes.
     */
    listHearths(): Promise<{
        hearths: HearthNode[];
    }>;
    /**
     * Query AI intelligence provider.
     * Direct call to the provider - does not go through Synap backend.
     */
    queryIntelligence(hearthNodeId: string, request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
    /**
     * Create a deployment entity.
     */
    createDeployment(deployment: {
        hearthNodeId: string;
        sourceType: "git" | "workspace" | "upload";
        sourceUrl?: string;
        artifactType: "static" | "containerized";
        status?: string;
    }): Promise<{
        deployment: Deployment;
    }>;
}
export declare function createAPIClient(config: {
    baseUrl: string;
    apiKey: string;
    workspaceId: string;
}): Promise<APIClient>;
export declare function checkPodHealth(baseUrl: string): Promise<{
    healthy: boolean;
    version?: string;
    error?: string;
}>;
export {};
//# sourceMappingURL=api-client.d.ts.map