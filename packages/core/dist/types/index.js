/**
 * Hestia CLI - Centralized Type System
 *
 * All types in one place for build-time, lint-time, and dev-time verification.
 * Uses proper enums and strict type safety.
 */
// ============================================================================
// Core Enums (Verified at all times)
// ============================================================================
export var PackageType;
(function (PackageType) {
    PackageType["CORE"] = "core";
    PackageType["GATEWAY"] = "gateway";
    PackageType["BUILDER"] = "builder";
    PackageType["INTELLIGENCE"] = "intelligence";
    PackageType["INFRASTRUCTURE"] = "infrastructure";
    PackageType["CONNECTOR"] = "connector";
})(PackageType || (PackageType = {}));
export var PackageSourceType;
(function (PackageSourceType) {
    PackageSourceType["DOCKER_COMPOSE"] = "docker_compose";
    PackageSourceType["BINARY"] = "binary";
    PackageSourceType["NPM"] = "npm";
    PackageSourceType["GIT"] = "git";
})(PackageSourceType || (PackageSourceType = {}));
export var PackageStatus;
(function (PackageStatus) {
    PackageStatus["INSTALLED"] = "installed";
    PackageStatus["RUNNING"] = "running";
    PackageStatus["STOPPED"] = "stopped";
    PackageStatus["ERROR"] = "error";
    PackageStatus["UPDATING"] = "updating";
})(PackageStatus || (PackageStatus = {}));
export var HearthRole;
(function (HearthRole) {
    HearthRole["PRIMARY"] = "primary";
    HearthRole["BACKUP"] = "backup";
    HearthRole["EDGE"] = "edge";
})(HearthRole || (HearthRole = {}));
export var InstallMode;
(function (InstallMode) {
    InstallMode["USB"] = "usb";
    InstallMode["SCRIPT"] = "script";
})(InstallMode || (InstallMode = {}));
export var HealthStatus;
(function (HealthStatus) {
    HealthStatus["HEALTHY"] = "healthy";
    HealthStatus["DEGRADED"] = "degraded";
    HealthStatus["OFFLINE"] = "offline";
})(HealthStatus || (HealthStatus = {}));
export var IntelligenceProvider;
(function (IntelligenceProvider) {
    IntelligenceProvider["OLLAMA"] = "ollama";
    IntelligenceProvider["OPENROUTER"] = "openrouter";
    IntelligenceProvider["ANTHROPIC"] = "anthropic";
    IntelligenceProvider["OPENAI"] = "openai";
    IntelligenceProvider["CUSTOM"] = "custom";
})(IntelligenceProvider || (IntelligenceProvider = {}));
export var DeploymentStatus;
(function (DeploymentStatus) {
    DeploymentStatus["PENDING"] = "pending";
    DeploymentStatus["BUILDING"] = "building";
    DeploymentStatus["DEPLOYED"] = "deployed";
    DeploymentStatus["FAILED"] = "failed";
})(DeploymentStatus || (DeploymentStatus = {}));
export var ArtifactType;
(function (ArtifactType) {
    ArtifactType["STATIC"] = "static";
    ArtifactType["CONTAINERIZED"] = "containerized";
})(ArtifactType || (ArtifactType = {}));
export var SourceType;
(function (SourceType) {
    SourceType["GIT"] = "git";
    SourceType["WORKSPACE"] = "workspace";
    SourceType["UPLOAD"] = "upload";
})(SourceType || (SourceType = {}));
export var AIChatProvider;
(function (AIChatProvider) {
    AIChatProvider["LOBECHAT"] = "lobechat";
    AIChatProvider["OPENWEBUI"] = "openwebui";
    AIChatProvider["LIBRECHAT"] = "librechat";
})(AIChatProvider || (AIChatProvider = {}));
export var ProxyType;
(function (ProxyType) {
    ProxyType["NGINX"] = "nginx";
    ProxyType["TRAEFIK"] = "traefik";
})(ProxyType || (ProxyType = {}));
export var TunnelProvider;
(function (TunnelProvider) {
    TunnelProvider["PANGOLIN"] = "pangolin";
    TunnelProvider["CLOUDFLARE"] = "cloudflare";
    TunnelProvider["NONE"] = "none";
})(TunnelProvider || (TunnelProvider = {}));
export var DBViewerProvider;
(function (DBViewerProvider) {
    DBViewerProvider["WHODB"] = "whodb";
    DBViewerProvider["NONE"] = "none";
})(DBViewerProvider || (DBViewerProvider = {}));
export * from "./config-types.js";
export * from "./ai-chat.js";
//# sourceMappingURL=index.js.map