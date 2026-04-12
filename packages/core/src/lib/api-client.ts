/**
 * Hestia CLI - API Client
 *
 * HTTP client for communicating with Synap Backend Hub Protocol API.
 */

import type {
  HearthNode,
  PackageInstance,
  IntelligenceProvider,
  Deployment,
  ChatCompletionRequest,
  ChatCompletionResponse,
  RegisterHearthConfig,
  HeartbeatData,
} from "../types.js";

interface APIClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class APIClient {
  private config: APIClientConfig;

  constructor(config: APIClientConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
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
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}${
            error ? ` - ${error}` : ""
          }`
        );
      }

      const result = (await response.json()) as APIResponse<T>;

      if (!result.success) {
        throw new Error(result.error || "API request failed");
      }

      return result.data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeout}ms`);
      }

      throw error;
    }
  }

  // ============ HEARTH ENDPOINTS ============

  async registerHearth(config: RegisterHearthConfig): Promise<{
    hearth_node: HearthNode;
    api_key: { id: string; key: string; scopes: string[] };
    intelligence_provider: IntelligenceProvider;
  }> {
    return this.request("/hearth/register", {
      method: "POST",
      body: config,
    });
  }

  async heartbeat(hearthNodeId: string, data: HeartbeatData): Promise<void> {
    await this.request("/hearth/heartbeat", {
      method: "POST",
      body: {
        hearth_node_id: hearthNodeId,
        ...data,
      },
    });
  }

  async getHearthStatus(hearthNodeId: string): Promise<{
    hearth_node: HearthNode;
    packages: PackageInstance[];
    intelligence_provider?: IntelligenceProvider;
  }> {
    return this.request(`/hearth/status/${hearthNodeId}`);
  }

  async listHearths(): Promise<{ hearths: HearthNode[] }> {
    return this.request("/hearth/list");
  }

  // ============ PACKAGE ENDPOINTS ============

  async registerPackage(pkg: {
    hearth_node_id: string;
    package_name: string;
    version: string;
    status: PackageInstance["status"];
    config?: Record<string, unknown>;
    endpoints?: { http?: string; websocket?: string };
  }): Promise<{ package_instance: PackageInstance }> {
    return this.request("/packages/register", {
      method: "POST",
      body: pkg,
    });
  }

  // ============ INTELLIGENCE ENDPOINTS ============

  async queryIntelligence(
    hearthNodeId: string,
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    return this.request("/intelligence/query", {
      method: "POST",
      body: {
        hearth_node_id: hearthNodeId,
        ...request,
      },
    });
  }

  async listIntelligenceModels(
    hearthNodeId: string
  ): Promise<{ provider_type: string; models: { id: string; name: string }[] }> {
    return this.request(`/intelligence/models/${hearthNodeId}`);
  }

  async checkIntelligenceHealth(
    hearthNodeId: string
  ): Promise<{ status: string; provider_type?: string; model?: string }> {
    return this.request(`/intelligence/health/${hearthNodeId}`);
  }

  // ============ DEPLOYMENT ENDPOINTS ============

  async createDeployment(deployment: {
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
  }> {
    return this.request("/hearth/deploy", {
      method: "POST",
      body: deployment,
    });
  }

  // ============ UTILITY ENDPOINTS ============

  async healthCheck(): Promise<{ status: string }> {
    return this.request("/health");
  }
}

// Factory function with config loading
export async function createAPIClient(config?: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<APIClient> {
  const baseUrl =
    config?.baseUrl ||
    process.env.HESTIA_POD_URL ||
    "http://localhost:4000";
  const apiKey =
    config?.apiKey ||
    process.env.HESTIA_API_KEY ||
    process.env.SYNAP_API_KEY;

  if (!apiKey) {
    throw new Error(
      "API key required. Set HESTIA_API_KEY environment variable or pass config."
    );
  }

  return new APIClient({ baseUrl, apiKey });
}

// Health check without authentication (for discovery)
export async function checkPodHealth(
  baseUrl: string
): Promise<{ healthy: boolean; version?: string; error?: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/hub/health`, {
      method: "GET",
      timeout: 5000,
    } as RequestInit);

    if (!response.ok) {
      return { healthy: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return {
      healthy: true,
      version: data.version,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
