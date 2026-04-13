/**
 * Hestia CLI - Comprehensive Test Suite
 *
 * Automated testing of all Hestia functionality with support for:
 * - Unit tests (individual components)
 * - Integration tests (component interactions)
 * - End-to-end tests (full workflows)
 * - Smoke tests (basic sanity checks)
 *
 * Features:
 * - Parallel test execution
 * - Test isolation with clean state
 * - Snapshot testing
 * - Performance benchmarks
 * - CI-friendly output modes
 */
import { ChildProcess } from "child_process";
/**
 * Individual test result
 */
export interface TestResult {
    passed: boolean;
    name: string;
    duration: number;
    error?: string;
    logs: string[];
    category: TestCategory;
    timestamp: Date;
    retries?: number;
}
/**
 * Test category
 */
export type TestCategory = "unit" | "integration" | "e2e" | "smoke" | "benchmark" | "snapshot";
/**
 * Test function type
 */
export type TestFunction = () => Promise<TestResult>;
/**
 * Test suite configuration
 */
export interface TestSuiteConfig {
    /** Enable parallel test execution */
    parallel: boolean;
    /** Maximum concurrent tests */
    maxConcurrency: number;
    /** Test timeout in milliseconds */
    timeout: number;
    /** Number of retries for flaky tests */
    retries: number;
    /** Enable verbose output */
    verbose: boolean;
    /** CI mode (no colors, JSON output) */
    ciMode: boolean;
    /** Enable watch mode */
    watch: boolean;
    /** Generate coverage report */
    coverage: boolean;
    /** Test environment directory */
    testEnvDir?: string;
    /** Fail fast on first error */
    failFast: boolean;
    /** Filter tests by name pattern */
    filter?: string;
}
/**
 * Test suite report
 */
export interface TestSuiteReport {
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        duration: number;
        startTime: Date;
        endTime: Date;
    };
    results: TestResult[];
    byCategory: Record<TestCategory, {
        passed: number;
        failed: number;
        duration: number;
    }>;
    coverage?: {
        lines: number;
        functions: number;
        branches: number;
    };
    failedTests: TestResult[];
    slowTests: TestResult[];
    flakyTests: TestResult[];
}
/**
 * Mock API configuration
 */
export interface MockApiConfig {
    port: number;
    responses: Map<string, MockResponse>;
    delay?: number;
    failRate?: number;
}
export interface MockResponse {
    status: number;
    data: unknown;
    headers?: Record<string, string>;
}
/**
 * Test environment state
 */
export interface TestEnvironment {
    dir: string;
    configPath: string;
    packagesDir: string;
    tempFiles: string[];
    processes: ChildProcess[];
    mocks: MockServer[];
    cleanup: () => Promise<void>;
}
/**
 * Mock server interface
 */
export interface MockServer {
    start(): Promise<void>;
    stop(): Promise<void>;
    setResponse(endpoint: string, response: MockResponse): void;
    getRequests(): Array<{
        endpoint: string;
        body: unknown;
        timestamp: Date;
    }>;
}
export declare class HestiaTestSuite {
    private config;
    private testEnv;
    private results;
    private isRunning;
    private fileWatcher;
    private mockApis;
    private coverageData;
    private testRegistry;
    constructor(config?: Partial<TestSuiteConfig>);
    private registerAllTests;
    private registerTest;
    /**
     * Run the complete test suite
     */
    runAllTests(): Promise<TestSuiteReport>;
    /**
     * Run tests from a specific category
     */
    runTests(category: TestCategory): Promise<TestSuiteReport>;
    /**
     * Run a single test by name
     */
    runTest(name: string): Promise<TestResult>;
    /**
     * Generate a test report
     */
    generateReport(startTime?: Date): TestSuiteReport;
    /**
     * Watch mode - run tests on file changes
     */
    watchMode(watchPath?: string): Promise<void>;
    /**
     * CI mode - run tests with CI-friendly output
     */
    ciMode(): Promise<TestSuiteReport>;
    /**
     * Test configuration loading/saving
     */
    private testConfig;
    /**
     * Test state manager operations
     */
    private testStateManager;
    /**
     * Test API client with mocking
     */
    private testApiClient;
    /**
     * Test package service operations
     */
    private testPackageService;
    /**
     * Test A2A bridge functionality
     */
    private testA2ABridge;
    /**
     * Test health check logic
     */
    private testHealthCheck;
    /**
     * Test Synap Backend connectivity
     */
    private testSynapBackendConnection;
    /**
     * Test OpenClaude integration
     */
    private testOpenClaudeIntegration;
    /**
     * Test OpenClaw integration
     */
    private testOpenClawIntegration;
    /**
     * Test A2A messaging between agents
     */
    private testA2AMessaging;
    /**
     * Test bidirectional state sync
     */
    private testStateSync;
    /**
     * Test complete installation flow
     */
    private testFullInstallation;
    /**
     * Test service start/stop/restart lifecycle
     */
    private testServiceLifecycle;
    /**
     * Test configuration wizard flow
     */
    private testConfigurationFlow;
    /**
     * Test package management operations
     */
    private testPackageManagement;
    /**
     * Test agents working together
     */
    private testAgentWorkflow;
    /**
     * Test all CLI commands run without errors
     */
    private testCLI;
    /**
     * Test all services can start
     */
    private testServices;
    /**
     * Test network connectivity
     */
    private testConnectivity;
    /**
     * Test data persistence
     */
    private testPersistence;
    /**
     * Create a mock Synap Backend API server
     */
    private createMockApiServer;
    /**
     * Create a test environment with isolated state
     */
    private createTestEnvironment;
    /**
     * Clean up test environment
     */
    private cleanupTestEnvironment;
    /**
     * Retry a flaky test
     */
    private retry;
    /**
     * Execute a function with timeout
     */
    private timeout;
    /**
     * Run tests in parallel
     */
    private runTestsParallel;
    /**
     * Run tests sequentially
     */
    private runTestsSequential;
    /**
     * Execute a single test with retry logic
     */
    private executeTest;
    /**
     * Execute a shell command
     */
    private execCommand;
    /**
     * Sleep for a given duration
     */
    private sleep;
    /**
     * Calculate coverage percentage
     */
    private calculateCoverage;
    private log;
    private outputResult;
    private outputReport;
}
/**
 * Singleton test suite instance
 */
export declare const testSuite: HestiaTestSuite;
/**
 * Run tests from command line
 */
export declare function main(): Promise<void>;
export default HestiaTestSuite;
//# sourceMappingURL=test-suite.d.ts.map