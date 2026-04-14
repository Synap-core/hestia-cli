/**
 * eve CLI - Centralized Type System
 *
 * All types in one place for build-time, lint-time, and dev-time verification.
 * Uses proper enums and strict type safety.
 */
// Error classes
export class eveError extends Error {
    code;
    exitCode;
    constructor(message, code, exitCode = 1) {
        super(message);
        this.code = code;
        this.exitCode = exitCode;
        this.name = "eveError";
    }
}
export class PackageError extends eveError {
    packageName;
    constructor(message, packageName) {
        super(message, "PACKAGE_ERROR", 2);
        this.packageName = packageName;
        this.name = "PackageError";
    }
}
export class HearthError extends eveError {
    hearthId;
    constructor(message, hearthId) {
        super(message, "HEARTH_ERROR", 3);
        this.hearthId = hearthId;
        this.name = "HearthError";
    }
}
export class IntelligenceError extends eveError {
    providerType;
    constructor(message, providerType) {
        super(message, "INTELLIGENCE_ERROR", 4);
        this.providerType = providerType;
        this.name = "IntelligenceError";
    }
}
// Export all extra types
export * from "./extra-types.js";
//# sourceMappingURL=index.js.map