/**
 * Hestia Workspace Definition
 *
 * Workspace template for sovereign infrastructure management.
 * Used with createFromDefinition to set up a Hestia workspace on any Synap pod.
 *
 * This is a generic definition that works with standard Synap APIs.
 */
export declare const HESTIA_DEFINITION: {
    readonly workspaceName: "Hestia Infrastructure";
    readonly description: "Sovereign AI infrastructure management console";
    readonly profiles: readonly [{
        readonly slug: "hearth_node";
        readonly displayName: "Hearth Node";
        readonly icon: "flame";
        readonly color: "#F97316";
        readonly description: "Sovereign infrastructure node (server, VM, or device)";
        readonly scope: "WORKSPACE";
        readonly properties: readonly [{
            readonly slug: "hostname";
            readonly label: "Hostname";
            readonly valueType: "STRING";
            readonly inputType: "text";
        }, {
            readonly slug: "ip_address";
            readonly label: "IP Address";
            readonly valueType: "STRING";
            readonly inputType: "text";
        }, {
            readonly slug: "role";
            readonly label: "Role";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["primary", "backup", "edge"];
        }, {
            readonly slug: "install_mode";
            readonly label: "Install Mode";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["usb", "script"];
        }, {
            readonly slug: "health_status";
            readonly label: "Health Status";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["healthy", "degraded", "offline"];
        }, {
            readonly slug: "last_heartbeat";
            readonly label: "Last Heartbeat";
            readonly valueType: "DATE";
            readonly inputType: "datetime";
        }, {
            readonly slug: "intelligence_provider_id";
            readonly label: "Intelligence Provider";
            readonly valueType: "ENTITY_REF";
            readonly inputType: "entity-select";
        }];
    }, {
        readonly slug: "intelligence_provider";
        readonly displayName: "Intelligence Provider";
        readonly icon: "brain";
        readonly color: "#8B5CF6";
        readonly description: "AI intelligence provider configuration";
        readonly scope: "WORKSPACE";
        readonly properties: readonly [{
            readonly slug: "provider_type";
            readonly label: "Provider Type";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["ollama", "openrouter", "anthropic", "openai", "custom"];
        }, {
            readonly slug: "endpoint_url";
            readonly label: "Endpoint URL";
            readonly valueType: "STRING";
            readonly inputType: "url";
        }, {
            readonly slug: "api_key_env";
            readonly label: "API Key Environment Variable";
            readonly valueType: "STRING";
            readonly inputType: "text";
        }, {
            readonly slug: "model";
            readonly label: "Model";
            readonly valueType: "STRING";
            readonly inputType: "text";
        }, {
            readonly slug: "status";
            readonly label: "Status";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["active", "inactive", "error"];
        }, {
            readonly slug: "capabilities";
            readonly label: "Capabilities";
            readonly valueType: "JSON";
            readonly inputType: "json";
        }];
    }, {
        readonly slug: "package_instance";
        readonly displayName: "Package Instance";
        readonly icon: "package";
        readonly color: "#3B82F6";
        readonly description: "Installed package on a hearth node";
        readonly scope: "WORKSPACE";
        readonly properties: readonly [{
            readonly slug: "package_name";
            readonly label: "Package Name";
            readonly valueType: "STRING";
            readonly inputType: "text";
        }, {
            readonly slug: "version";
            readonly label: "Version";
            readonly valueType: "STRING";
            readonly inputType: "text";
        }, {
            readonly slug: "status";
            readonly label: "Status";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["installed", "running", "stopped", "error", "updating"];
        }, {
            readonly slug: "hearth_node_id";
            readonly label: "Hearth Node";
            readonly valueType: "ENTITY_REF";
            readonly inputType: "entity-select";
        }, {
            readonly slug: "config";
            readonly label: "Configuration";
            readonly valueType: "JSON";
            readonly inputType: "json";
        }, {
            readonly slug: "installed_at";
            readonly label: "Installed At";
            readonly valueType: "DATE";
            readonly inputType: "datetime";
        }, {
            readonly slug: "last_updated";
            readonly label: "Last Updated";
            readonly valueType: "DATE";
            readonly inputType: "datetime";
        }];
    }, {
        readonly slug: "hearth_deployment";
        readonly displayName: "Deployment";
        readonly icon: "rocket";
        readonly color: "#10B981";
        readonly description: "Deployed artifact or application";
        readonly scope: "WORKSPACE";
        readonly properties: readonly [{
            readonly slug: "artifact_type";
            readonly label: "Artifact Type";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["static", "containerized"];
        }, {
            readonly slug: "source_type";
            readonly label: "Source Type";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["git", "workspace", "upload"];
        }, {
            readonly slug: "source_url";
            readonly label: "Source URL";
            readonly valueType: "STRING";
            readonly inputType: "url";
        }, {
            readonly slug: "status";
            readonly label: "Status";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["pending", "building", "deployed", "failed"];
        }, {
            readonly slug: "deploy_url";
            readonly label: "Deploy URL";
            readonly valueType: "STRING";
            readonly inputType: "url";
        }, {
            readonly slug: "hearth_node_id";
            readonly label: "Hearth Node";
            readonly valueType: "ENTITY_REF";
            readonly inputType: "entity-select";
        }];
    }, {
        readonly slug: "intelligence_query_log";
        readonly displayName: "Query Log";
        readonly icon: "clipboard-list";
        readonly color: "#6B7280";
        readonly description: "Log of intelligence provider queries (auto-created)";
        readonly scope: "WORKSPACE";
        readonly properties: readonly [{
            readonly slug: "hearth_node_id";
            readonly label: "Hearth Node";
            readonly valueType: "ENTITY_REF";
            readonly inputType: "entity-select";
        }, {
            readonly slug: "provider_type";
            readonly label: "Provider Type";
            readonly valueType: "STRING";
            readonly inputType: "select";
            readonly enumValues: readonly ["ollama", "openrouter", "anthropic", "openai", "custom"];
        }, {
            readonly slug: "model";
            readonly label: "Model";
            readonly valueType: "STRING";
            readonly inputType: "text";
        }, {
            readonly slug: "prompt_tokens";
            readonly label: "Prompt Tokens";
            readonly valueType: "NUMBER";
            readonly inputType: "number";
        }, {
            readonly slug: "completion_tokens";
            readonly label: "Completion Tokens";
            readonly valueType: "NUMBER";
            readonly inputType: "number";
        }, {
            readonly slug: "query_time";
            readonly label: "Query Time";
            readonly valueType: "DATE";
            readonly inputType: "datetime";
        }];
    }];
    readonly views: readonly [{
        readonly name: "Hearth Nodes";
        readonly displayName: "Hearth Nodes";
        readonly type: "table";
        readonly scopeProfileSlug: "hearth_node";
        readonly config: {
            readonly columns: readonly ["title", "hostname", "ip_address", "role", "health_status", "last_heartbeat"];
            readonly sortBy: "last_heartbeat";
            readonly sortDir: "desc";
        };
    }, {
        readonly name: "Infrastructure Map";
        readonly displayName: "Infrastructure Map";
        readonly type: "graph";
        readonly scopeProfileSlugs: readonly ["hearth_node", "package_instance", "intelligence_provider"];
        readonly config: {
            readonly layout: "force";
            readonly showLabels: true;
        };
    }, {
        readonly name: "Package Status";
        readonly displayName: "Package Status";
        readonly type: "kanban";
        readonly scopeProfileSlug: "package_instance";
        readonly config: {
            readonly groupBy: "status";
            readonly columns: readonly ["installed", "running", "stopped", "error", "updating"];
        };
    }, {
        readonly name: "Deployments";
        readonly displayName: "Deployments";
        readonly type: "kanban";
        readonly scopeProfileSlug: "hearth_deployment";
        readonly config: {
            readonly groupBy: "status";
            readonly columns: readonly ["pending", "building", "deployed", "failed"];
        };
    }, {
        readonly name: "Intelligence Providers";
        readonly displayName: "Intelligence Providers";
        readonly type: "table";
        readonly scopeProfileSlug: "intelligence_provider";
        readonly config: {
            readonly columns: readonly ["title", "provider_type", "model", "status"];
            readonly sortBy: "status";
            readonly sortDir: "asc";
        };
    }];
    readonly entityLinks: readonly [{
        readonly sourceProfileSlug: "hearth_node";
        readonly targetProfileSlug: "intelligence_provider";
        readonly type: "uses_provider";
        readonly label: "Uses Provider";
    }, {
        readonly sourceProfileSlug: "package_instance";
        readonly targetProfileSlug: "hearth_node";
        readonly type: "installed_on";
        readonly label: "Installed On";
    }, {
        readonly sourceProfileSlug: "hearth_deployment";
        readonly targetProfileSlug: "hearth_node";
        readonly type: "deployed_to";
        readonly label: "Deployed To";
    }];
    readonly bentoLayout: readonly [{
        readonly widgetType: "stat-card";
        readonly pos: {
            readonly x: 0;
            readonly y: 0;
            readonly w: 3;
            readonly h: 3;
        };
        readonly config: {
            readonly label: "Hearth Nodes";
            readonly aggregation: "count";
            readonly profileSlug: "hearth_node";
            readonly icon: "Flame";
        };
    }, {
        readonly widgetType: "stat-card";
        readonly pos: {
            readonly x: 3;
            readonly y: 0;
            readonly w: 3;
            readonly h: 3;
        };
        readonly config: {
            readonly label: "Active Providers";
            readonly aggregation: "count";
            readonly profileSlug: "intelligence_provider";
            readonly icon: "Brain";
            readonly filter: {
                readonly status: "active";
            };
        };
    }, {
        readonly widgetType: "stat-card";
        readonly pos: {
            readonly x: 6;
            readonly y: 0;
            readonly w: 3;
            readonly h: 3;
        };
        readonly config: {
            readonly label: "Running Packages";
            readonly aggregation: "count";
            readonly profileSlug: "package_instance";
            readonly icon: "Package";
            readonly filter: {
                readonly status: "running";
            };
        };
    }, {
        readonly widgetType: "stat-card";
        readonly pos: {
            readonly x: 9;
            readonly y: 0;
            readonly w: 3;
            readonly h: 3;
        };
        readonly config: {
            readonly label: "Active Deployments";
            readonly aggregation: "count";
            readonly profileSlug: "hearth_deployment";
            readonly icon: "Rocket";
            readonly filter: {
                readonly status: "deployed";
            };
        };
    }, {
        readonly widgetType: "entity-list";
        readonly pos: {
            readonly x: 0;
            readonly y: 3;
            readonly w: 6;
            readonly h: 6;
        };
        readonly config: {
            readonly title: "Hearth Nodes Status";
            readonly profileSlug: "hearth_node";
            readonly columns: readonly ["hostname", "health_status", "last_heartbeat"];
            readonly limit: 5;
        };
    }, {
        readonly widgetType: "entity-gallery";
        readonly pos: {
            readonly x: 6;
            readonly y: 3;
            readonly w: 6;
            readonly h: 6;
        };
        readonly config: {
            readonly title: "Recent Deployments";
            readonly profileSlug: "hearth_deployment";
            readonly limit: 4;
        };
    }, {
        readonly widgetType: "entity-list";
        readonly pos: {
            readonly x: 0;
            readonly y: 9;
            readonly w: 6;
            readonly h: 6;
        };
        readonly config: {
            readonly title: "Intelligence Providers";
            readonly profileSlug: "intelligence_provider";
            readonly columns: readonly ["provider_type", "model", "status"];
            readonly limit: 5;
        };
    }, {
        readonly widgetType: "feed";
        readonly pos: {
            readonly x: 6;
            readonly y: 9;
            readonly w: 6;
            readonly h: 6;
        };
        readonly config: {
            readonly title: "Infrastructure Activity";
            readonly limit: 10;
        };
    }];
    readonly layoutConfig: {
        readonly pinnedApps: readonly ["dashboard", "chat", "data"];
        readonly sidebarItems: readonly [{
            readonly kind: "app";
            readonly appId: "dashboard";
            readonly label: "Home";
        }, {
            readonly kind: "app";
            readonly appId: "chat";
            readonly label: "AI Chat";
        }, {
            readonly kind: "view";
            readonly viewName: "Hearth Nodes";
            readonly label: "Nodes";
            readonly icon: "flame";
        }, {
            readonly kind: "view";
            readonly viewName: "Package Status";
            readonly label: "Packages";
            readonly icon: "package";
        }, {
            readonly kind: "view";
            readonly viewName: "Deployments";
            readonly label: "Deployments";
            readonly icon: "rocket";
        }, {
            readonly kind: "view";
            readonly viewName: "Intelligence Providers";
            readonly label: "AI Providers";
            readonly icon: "brain";
        }, {
            readonly kind: "view";
            readonly viewName: "Infrastructure Map";
            readonly label: "Map";
            readonly icon: "map";
        }];
    };
};
export default HESTIA_DEFINITION;
//# sourceMappingURL=hestia-definition.d.ts.map