/**
 * Hestia CLI - API Client
 *
 * HTTP client for communicating with Synap Backend Hub Protocol API.
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
        const url = `${this.config.baseUrl}/api/hub${endpoint}`;
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
            const result = (await response.json());
            if (!result.success) {
                throw new Error(result.error || "API request failed");
            }
            return result.data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`Request timeout after ${timeout}ms`);
            }
            throw error;
        }
    }
    // ============ HEARTH ENDPOINTS ============
    async registerHearth(config) {
        return this.request("/hearth/register", {
            method: "POST",
            body: config,
        });
    }
    async heartbeat(hearthNodeId, data) {
        await this.request("/hearth/heartbeat", {
            method: "POST",
            body: {
                hearth_node_id: hearthNodeId,
                ...data,
            },
        });
    }
    async getHearthStatus(hearthNodeId) {
        return this.request(`/hearth/status/${hearthNodeId}`);
    }
    async listHearths() {
        return this.request("/hearth/list");
    }
    // ============ PACKAGE ENDPOINTS ============
    async registerPackage(pkg) {
        return this.request("/packages/register", {
            method: "POST",
            body: pkg,
        });
    }
    // ============ INTELLIGENCE ENDPOINTS ============
    async queryIntelligence(hearthNodeId, request) {
        return this.request("/intelligence/query", {
            method: "POST",
            body: {
                hearth_node_id: hearthNodeId,
                ...request,
            },
        });
    }
    async listIntelligenceModels(hearthNodeId) {
        return this.request(`/intelligence/models/${hearthNodeId}`);
    }
    async checkIntelligenceHealth(hearthNodeId) {
        return this.request(`/intelligence/health/${hearthNodeId}`);
    }
    // ============ DEPLOYMENT ENDPOINTS ============
    async createDeployment(deployment) {
        return this.request("/hearth/deploy", {
            method: "POST",
            body: deployment,
        });
    }
    // ============ UTILITY ENDPOINTS ============
    async healthCheck() {
        return this.request("/health");
    }
}
// Factory function with config loading
export async function createAPIClient(config) {
    const baseUrl = config?.baseUrl ||
        process.env.HESTIA_POD_URL ||
        "http://localhost:4000";
    const apiKey = config?.apiKey ||
        process.env.HESTIA_API_KEY ||
        process.env.SYNAP_API_KEY;
    if (!apiKey) {
        throw new Error("API key required. Set HESTIA_API_KEY environment variable or pass config.");
    }
    return new APIClient({ baseUrl, apiKey });
}
// Health check without authentication (for discovery)
export async function checkPodHealth(baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/api/hub/health`, {
            method: "GET",
            timeout: 5000,
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