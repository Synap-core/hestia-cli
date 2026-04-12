/**
 * Hestia CLI - Core Types
 *
 * Central type definitions for the Hestia package system.
 */
// Error Types
export class HestiaError extends Error {
    code;
    exitCode;
    constructor(message, code, exitCode = 1) {
        super(message);
        this.code = code;
        this.exitCode = exitCode;
        this.name = "HestiaError";
    }
}
export class PackageError extends HestiaError {
    packageName;
    constructor(message, packageName) {
        super(message, "PACKAGE_ERROR", 2);
        this.packageName = packageName;
        this.name = "PackageError";
    }
}
export class HearthError extends HestiaError {
    hearthId;
    constructor(message, hearthId) {
        super(message, "HEARTH_ERROR", 3);
        this.hearthId = hearthId;
        this.name = "HearthError";
    }
}
export class IntelligenceError extends HestiaError {
    providerType;
    constructor(message, providerType) {
        super(message, "INTELLIGENCE_ERROR", 4);
        this.providerType = providerType;
        this.name = "IntelligenceError";
    }
}
//# sourceMappingURL=types.js.map