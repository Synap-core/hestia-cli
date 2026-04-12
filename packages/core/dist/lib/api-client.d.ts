/**
 * Hestia CLI - API Client
 *
 * HTTP client for communicating with Synap Backend Hub Protocol API.
 */
import type { HearthNode, PackageInstance, IntelligenceProvider, Deployment, ChatCompletionRequest, ChatCompletionResponse, RegisterHearthConfig, HeartbeatData } from "../types.js";
interface APIClientConfig {
    baseUrl: string;
    apiKey: string;
    timeout?: number;
}
export declare class APIClient {
    private config;
    constructor(config: APIClientConfig);
    private request;
    registerHearth(config: RegisterHearthConfig): Promise<{
        hearth_node: HearthNode;
        api_key: {
            id: string;
            key: string;
            scopes: string[];
        };
        intelligence_provider: IntelligenceProvider;
    }>;
    heartbeat(hearthNodeId: string, data: HeartbeatData): Promise<void>;
    getHearthStatus(hearthNodeId: string): Promise<{
        hearth_node: HearthNode;
        packages: PackageInstance[];
        intelligence_provider?: IntelligenceProvider;
    }>;
    listHearths(): Promise<{
        hearths: HearthNode[];
    }>;
    registerPackage(pkg: {
        hearth_node_id: string;
        package_name: string;
        version: string;
        status: PackageInstance["status"];
        config?: Record<string, unknown>;
        endpoints?: {
            http?: string;
            websocket?: string;
        };
    }): Promise<{
        package_instance: PackageInstance;
    }>;
    queryIntelligence(hearthNodeId: string, request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
    listIntelligenceModels(hearthNodeId: string): Promise<{
        provider_type: string;
        models: {
            id: string;
            name: string;
        }[];
    }>;
    checkIntelligenceHealth(hearthNodeId: string): Promise<{
        status: string;
        provider_type?: string;
        model?: string;
    }>;
    createDeployment(deployment: {
        hearth_node_id: string;
        source_type: "git" | "workspace" | "upload";
        source_url?: string;
        artifact_type: "static" | "containerized";
        build_config?: {
            command?: string;
            output_dir?: string;
            env_vars?: Record<string, string>;
        };
        requires_approval?: boolean;
    }): Promise<{
        deployment: Deployment;
        message: string;
    }>;
    healthCheck(): Promise<{
        status: string;
    }>;
}
export declare function createAPIClient(config?: {
    baseUrl?: string;
    apiKey?: string;
}): Promise<APIClient>;
export declare function checkPodHealth(baseUrl: string): Promise<{
    healthy: boolean;
    version?: string;
    error?: string;
}>;
export {};
//# sourceMappingURL=api-client.d.ts.map