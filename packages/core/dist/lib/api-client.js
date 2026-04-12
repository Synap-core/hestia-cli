// @ts-nocheck
/**
 * Hestia CLI - API Client
 *
 * Uses standard Synap Hub Protocol APIs for infrastructure management.
 * All operations go through generic entity endpoints.
 */
export class APIClient {
    config;
    constructor(config) {
        this.config = {
            timeout: 30000,
            ...config,
        };
    }
    async request(endpoint, options = {}) {
        const url = `${this.config.baseUrl}${endpoint}`;
        const timeout = options.timeout || this.config.timeout || 30000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {
                method: options.method || "GET",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.config.apiKey}`,
                    ...options.headers,
                },
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API request failed: ${response.status} ${response.statusText}${error ? ` - ${error}` : ""}`);
            }
            return await response.json();
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`Request timeout after ${timeout}ms`);
            }
            throw error;
        }
    }
    // ============ ENTITY OPERATIONS (Standard Synap API) ============
    /**
     * Create an entity using the standard Synap entities.create endpoint.
     * All Hestia infrastructure components are stored as entities.
     */
    async createEntity(params) {
        const result = await this.request("/trpc/entities.create", {
            method: "POST",
            body: {
                profileSlug: params.profileSlug,
                title: params.title,
                properties: params.properties || {},
            },
        });
        if (result.error) {
            throw new Error(result.error.message);
        }
        return {
            id: result.result?.data?.id || "",
            success: true,
        };
    }
    /**
     * Update an entity using the standard Synap entities.update endpoint.
     */
    async updateEntity(entityId, properties) {
        const result = await this.request("/trpc/entities.update", {
            method: "POST",
            body: {
                entityId,
                properties,
            },
        });
        if (result.error) {
            throw new Error(result.error.message);
        }
        return result.result?.data || false;
    }
    /**
     * List entities using the standard Synap entities.list endpoint.
     */
    async listEntities(profileSlug) {
        const result = await this.request(`/trpc/entities.list?input=${encodeURIComponent(JSON.stringify({ profileSlug }))}`, {
            method: "GET",
        });
        if (result.error) {
            throw new Error(result.error.message);
        }
        return result.result?.data?.entities || [];
    }
    /**
     * Get a single entity using the standard Synap entities.get endpoint.
     */
    async getEntity(entityId) {
        const result = await this.request(`/trpc/entities.get?input=${encodeURIComponent(JSON.stringify({ id: entityId }))}`, {
            method: "GET",
        });
        if (result.error) {
            return null;
        }
        return result.result?.data || null;
    }
    // ============ HEARTH NODE OPERATIONS ============
    /**
     * Register a new hearth node.
     * Creates two entities: intelligence_provider and hearth_node (linked).
     */
    async registerHearth(config) {
        // 1. Create intelligence provider entity
        const providerResult = await this.createEntity({
            profileSlug: "intelligence_provider",
            title: `${config.intelligenceProvider.providerType} - ${config.intelligenceProvider.model}`,
            properties: {
                provider_type: config.intelligenceProvider.providerType,
                endpoint_url: config.intelligenceProvider.endpointUrl,
                api_key_env: config.intelligenceProvider.apiKeyEnv,
                model: config.intelligenceProvider.model,
                status: "active",
                capabilities: ["chat"],
                config: config.intelligenceProvider.config || {},
            },
        });
        // 2. Create hearth node entity
        const hearthResult = await this.createEntity({
            profileSlug: "hearth_node",
            title: config.hostname,
            properties: {
                hostname: config.hostname,
                ip_address: config.ipAddress,
                role: config.role,
                install_mode: config.installMode,
                intelligence_provider_id: providerResult.id,
                health_status: "healthy",
                last_heartbeat: new Date().toISOString(),
                packages: [],
            },
        });
        return {
            hearth_node: {
                id: hearthResult.id,
                hostname: config.hostname,
                role: config.role,
                health_status: "healthy",
                intelligence_provider_id: providerResult.id,
            },
            intelligence_provider: {
                id: providerResult.id,
                provider_type: config.intelligenceProvider.providerType,
                model: config.intelligenceProvider.model,
                status: "active",
            },
        };
    }
    /**
     * Send heartbeat for a hearth node.
     * Updates the hearth_node entity and creates/updates package_instance entities.
     */
    async heartbeat(hearthNodeId, data) {
        // 1. Get current hearth node
        const hearth = await this.getEntity(hearthNodeId);
        if (!hearth) {
            throw new Error(`Hearth node not found: ${hearthNodeId}`);
        }
        // 2. Update hearth node with new data
        await this.updateEntity(hearthNodeId, {
            ...hearth.properties,
            last_heartbeat: new Date().toISOString(),
            health_status: data.healthStatus,
            packages: data.packages.map(p => ({
                name: p.packageName,
                version: p.version,
                status: p.status,
            })),
            resource_usage: data.resourceUsage,
        });
        // 3. Get existing packages for this hearth node
        const allPackages = await this.listEntities("package_instance");
        const existingPackages = allPackages.filter(p => p.properties?.hearth_node_id === hearthNodeId);
        // 4. Update or create package entities
        for (const pkg of data.packages) {
            const existing = existingPackages.find(p => p.properties?.package_name === pkg.packageName);
            if (existing) {
                // Update existing
                await this.updateEntity(existing.id, {
                    ...existing.properties,
                    version: pkg.version,
                    status: pkg.status,
                    config: pkg.config,
                    last_updated: new Date().toISOString(),
                });
            }
            else {
                // Create new package entity
                await this.createEntity({
                    profileSlug: "package_instance",
                    title: pkg.packageName,
                    properties: {
                        package_name: pkg.packageName,
                        version: pkg.version,
                        status: pkg.status,
                        hearth_node_id: hearthNodeId,
                        config: pkg.config,
                        installed_at: new Date().toISOString(),
                        last_updated: new Date().toISOString(),
                    },
                });
            }
        }
        // 5. Update intelligence provider if provided
        if (data.intelligence) {
            const providerId = hearth.properties?.intelligence_provider_id;
            if (providerId) {
                const provider = await this.getEntity(providerId);
                if (provider) {
                    await this.updateEntity(providerId, {
                        ...provider.properties,
                        status: data.intelligence.status,
                        ...(data.intelligence.model && { model: data.intelligence.model }),
                    });
                }
            }
        }
    }
    /**
     * Get hearth node status with packages and provider.
     */
    async getHearthStatus(hearthNodeId) {
        const hearth = await this.getEntity(hearthNodeId);
        if (!hearth) {
            throw new Error(`Hearth node not found: ${hearthNodeId}`);
        }
        // Get packages
        const allPackages = await this.listEntities("package_instance");
        const packages = allPackages
            .filter(p => p.properties?.hearth_node_id === hearthNodeId)
            .map(p => ({
            id: p.id,
            packageName: p.properties?.package_name,
            version: p.properties?.version,
            status: p.properties?.status,
        }));
        // Get intelligence provider
        let provider;
        const providerId = hearth.properties?.intelligence_provider_id;
        if (providerId) {
            const providerEntity = await this.getEntity(providerId);
            if (providerEntity) {
                provider = {
                    id: providerEntity.id,
                    providerType: providerEntity.properties?.provider_type,
                    model: providerEntity.properties?.model,
                    status: providerEntity.properties?.status,
                };
            }
        }
        return {
            hearth_node: {
                id: hearth.id,
                hostname: hearth.properties?.hostname,
                role: hearth.properties?.role,
                health_status: hearth.properties?.health_status,
                last_heartbeat: hearth.properties?.last_heartbeat,
                install_mode: hearth.properties?.install_mode,
            },
            packages,
            intelligence_provider: provider,
        };
    }
    /**
     * List all hearth nodes.
     */
    async listHearths() {
        const entities = await this.listEntities("hearth_node");
        return {
            hearths: entities.map(h => ({
                id: h.id,
                hostname: h.properties?.hostname,
                role: h.properties?.role,
                health_status: h.properties?.health_status,
                last_heartbeat: h.properties?.last_heartbeat,
                install_mode: h.properties?.install_mode,
            })),
        };
    }
    // ============ INTELLIGENCE OPERATIONS ============
    /**
     * Query AI intelligence provider.
     * Direct call to the provider - does not go through Synap backend.
     */
    async queryIntelligence(hearthNodeId, request) {
        const hearth = await this.getEntity(hearthNodeId);
        if (!hearth) {
            throw new Error(`Hearth node not found: ${hearthNodeId}`);
        }
        const providerId = hearth.properties?.intelligence_provider_id;
        if (!providerId) {
            throw new Error("No intelligence provider configured");
        }
        const provider = await this.getEntity(providerId);
        if (!provider) {
            throw new Error("Intelligence provider not found");
        }
        const props = provider.properties || {};
        const providerType = props.provider_type;
        const endpointUrl = props.endpoint_url || "http://localhost:11434";
        const defaultModel = props.model;
        const apiKeyEnv = props.api_key_env;
        // Get API key from env if configured
        let apiKey;
        if (apiKeyEnv && typeof process.env[apiKeyEnv] === "string") {
            apiKey = process.env[apiKeyEnv];
        }
        const model = request.model || defaultModel;
        // Query the provider directly (not through Synap backend)
        if (providerType === "ollama") {
            const response = await fetch(`${endpointUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model,
                    messages: request.messages,
                    tools: request.tools,
                    options: {
                        temperature: request.temperature,
                        num_predict: request.max_tokens,
                    },
                    stream: false,
                }),
            });
            if (!response.ok) {
                throw new Error(`Ollama error: ${response.status}`);
            }
            const data = await response.json();
            return {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                        index: 0,
                        message: {
                            role: "assistant",
                            content: data.message?.content || "",
                        },
                        finish_reason: "stop",
                    }],
                usage: {
                    prompt_tokens: data.prompt_eval_count || 0,
                    completion_tokens: data.eval_count || 0,
                    total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
                },
            };
        }
        else {
            // OpenAI-compatible providers
            const response = await fetch(`${endpointUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
                },
                body: JSON.stringify({
                    model,
                    messages: request.messages,
                    temperature: request.temperature,
                    max_tokens: request.max_tokens,
                    tools: request.tools,
                    stream: false,
                }),
            });
            if (!response.ok) {
                throw new Error(`Provider error: ${response.status}`);
            }
            return await response.json();
        }
    }
    // ============ DEPLOYMENT OPERATIONS ============
    /**
     * Create a deployment entity.
     */
    async createDeployment(deployment) {
        const result = await this.createEntity({
            profileSlug: "hearth_deployment",
            title: `Deployment ${new Date().toISOString()}`,
            properties: {
                hearth_node_id: deployment.hearthNodeId,
                source_type: deployment.sourceType,
                source_url: deployment.sourceUrl,
                artifact_type: deployment.artifactType,
                status: deployment.status || "pending",
                created_at: new Date().toISOString(),
            },
        });
        return {
            deployment: {
                id: result.id,
                ...deployment,
                status: deployment.status || "pending",
            },
        };
    }
}
// Factory function
export async function createAPIClient(config) {
    return new APIClient(config);
}
// Health check
export async function checkPodHealth(baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/api/hub/health`, {
            method: "GET",
        });
        if (!response.ok) {
            return { healthy: false, error: `HTTP ${response.status}` };
        }
        const data = await response.json();
        return {
            healthy: true,
            version: data.version,
        };
    }
    catch (error) {
        return {
            healthy: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
//# sourceMappingURL=api-client.js.map