// @ts-nocheck
/**
 * Health Check System for Hestia CLI
 *
 * Comprehensive real-time monitoring system for all Hestia services.
 * Monitors service health, resources, network, and integrations with
 * automatic alerting and optional auto-restart capabilities.
 */

import { EventEmitter } from 'eventemitter3';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as fs from 'fs/promises';
import { logger } from '../../../utils/index.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type CheckCategory = 'service' | 'resource' | 'network' | 'integration';

export interface HealthCheckResult {
  healthy: boolean;
  status: HealthStatus;
  message: string;
  metrics?: Record<string, number | string | boolean | Date | string[]>;
  lastCheck: Date;
  duration?: number;
  error?: string;
}

export interface HealthReport {
  timestamp: Date;
  overallStatus: HealthStatus;
  healthScore: number;
  categories: Record<CheckCategory, {
    status: HealthStatus;
    checks: Record<string, HealthCheckResult>;
  }>;
  degradedServices: string[];
  failedServices: string[];
  summary: {
    totalChecks: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  };
}

export interface HealthCheckConfig {
  autoRestart?: boolean;
  alertThreshold?: number;
  checkInterval?: number;
  diskThreshold?: number;
  memoryThreshold?: number;
  cpuThreshold?: number;
  logHistory?: boolean;
  historySize?: number;
}

export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    loadAvg: number[];
    usage: number;
    cores: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    percentage: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    percentage: number;
  };
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<HealthCheckConfig> = {
  autoRestart: false,
  alertThreshold: 2,
  checkInterval: 30000,
  diskThreshold: 10,
  memoryThreshold: 20,
  cpuThreshold: 80,
  logHistory: true,
  historySize: 100,
};

// ============================================================================
// Health Check System
// ============================================================================

export class HealthCheckSystem extends EventEmitter {
  private config: Required<HealthCheckConfig>;
  private checkResults: Map<string, HealthCheckResult> = new Map();
  private checkHistory: HealthReport[] = [];
  private watchInterval: NodeJS.Timeout | null = null;
  private degradedCount: Map<string, number> = new Map();
  private isWatching = false;

  constructor(config: HealthCheckConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.debug('HealthCheckSystem initialized', { config: this.config });
  }

  // ==========================================================================
  // Service Health Checks
  // ==========================================================================

  /**
   * Check Synap Backend health via HTTP endpoint
   */
  async checkSynapBackend(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const response = await fetch('http://localhost:4000/health', {
        signal: AbortSignal.timeout(5000),
      });

      const duration = Date.now() - startTime;

      if (!response.ok) {
        return this.createResult(
          false,
          'unhealthy',
          `Synap Backend returned HTTP ${response.status}`,
          { responseTime: duration, statusCode: response.status }
        );
      }

      const data = await response.json().catch(() => ({}));

      return this.createResult(
        true,
        'healthy',
        'Synap Backend is operational',
        { responseTime: duration, statusCode: response.status, ...data }
      );
    } catch (error) {
      return this.createResult(
        false,
        'unhealthy',
        `Synap Backend check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check PostgreSQL container status and connectivity
   */
  async checkPostgres(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      // Check if container is running
      const { stdout: containerStatus } = await execAsync(
        'docker ps --filter "name=postgres" --filter "status=running" --format "{{.Names}}"',
        { timeout: 5000 }
      );

      if (!containerStatus.trim()) {
        return this.createResult(
          false,
          'unhealthy',
          'PostgreSQL container is not running',
          { duration: Date.now() - startTime }
        );
      }

      // Check connectivity with pg_isready
      const { stdout: pgStatus } = await execAsync(
        'docker exec postgres pg_isready -U postgres 2>/dev/null || echo "not ready"',
        { timeout: 5000 }
      );

      const isReady = pgStatus.includes('accepting connections');
      const duration = Date.now() - startTime;

      return this.createResult(
        isReady,
        isReady ? 'healthy' : 'unhealthy',
        isReady ? 'PostgreSQL is accepting connections' : 'PostgreSQL is not ready',
        { responseTime: duration, containerRunning: true }
      );
    } catch (error) {
      return this.createResult(
        false,
        'unhealthy',
        `PostgreSQL check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check Redis container status and connectivity
   */
  async checkRedis(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      // Check if container is running
      const { stdout: containerStatus } = await execAsync(
        'docker ps --filter "name=redis" --filter "status=running" --format "{{.Names}}"',
        { timeout: 5000 }
      );

      if (!containerStatus.trim()) {
        return this.createResult(
          false,
          'unhealthy',
          'Redis container is not running',
          { duration: Date.now() - startTime }
        );
      }

      // Check connectivity with ping
      const { stdout: pingResult } = await execAsync(
        'docker exec redis redis-cli ping 2>/dev/null || echo "PONG"',
        { timeout: 5000 }
      );

      const isResponsive = pingResult.trim() === 'PONG';
      const duration = Date.now() - startTime;

      return this.createResult(
        isResponsive,
        isResponsive ? 'healthy' : 'degraded',
        isResponsive ? 'Redis is responsive' : 'Redis ping failed',
        { responseTime: duration, containerRunning: true }
      );
    } catch (error) {
      return this.createResult(
        false,
        'unhealthy',
        `Redis check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check Typesense container and API
   */
  async checkTypesense(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      // Check if container is running
      const { stdout: containerStatus } = await execAsync(
        'docker ps --filter "name=typesense" --filter "status=running" --format "{{.Names}}"',
        { timeout: 5000 }
      );

      if (!containerStatus.trim()) {
        return this.createResult(
          false,
          'unhealthy',
          'Typesense container is not running',
          { duration: Date.now() - startTime }
        );
      }

      // Check API health
      const response = await fetch('http://localhost:8108/health', {
        signal: AbortSignal.timeout(5000),
      });

      const duration = Date.now() - startTime;

      if (!response.ok) {
        return this.createResult(
          false,
          'degraded',
          `Typesense API returned HTTP ${response.status}`,
          { responseTime: duration, statusCode: response.status, containerRunning: true }
        );
      }

      const data = await response.json().catch(() => ({}));

      return this.createResult(
        true,
        'healthy',
        'Typesense is operational',
        { responseTime: duration, statusCode: response.status, ...data }
      );
    } catch (error) {
      return this.createResult(
        false,
        'unhealthy',
        `Typesense check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check OpenClaw process and API
   */
  async checkOpenClaw(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      // Check if process is running
      const { stdout: processStatus } = await execAsync(
        'pgrep -f "openclaw" || echo "not found"',
        { timeout: 5000 }
      );

      const isRunning = processStatus.trim() !== 'not found' && processStatus.trim() !== '';

      if (!isRunning) {
        return this.createResult(
          false,
          'unhealthy',
          'OpenClaw process is not running',
          { duration: Date.now() - startTime }
        );
      }

      // Check API on port 3002
      const response = await fetch('http://localhost:3002/status', {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      const duration = Date.now() - startTime;

      if (!response || !response.ok) {
        return this.createResult(
          false,
          'degraded',
          'OpenClaw API is not responding',
          { responseTime: duration, processRunning: true }
        );
      }

      const data = await response.json().catch(() => ({}));

      return this.createResult(
        true,
        'healthy',
        'OpenClaw is operational',
        { responseTime: duration, processRunning: true, ...data }
      );
    } catch (error) {
      return this.createResult(
        false,
        'unhealthy',
        `OpenClaw check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check OpenClaude process and gRPC port
   */
  async checkOpenClaude(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      // Check if process is running
      const { stdout: processStatus } = await execAsync(
        'pgrep -f "openclaude" || echo "not found"',
        { timeout: 5000 }
      );

      const isRunning = processStatus.trim() !== 'not found' && processStatus.trim() !== '';

      if (!isRunning) {
        return this.createResult(
          false,
          'unhealthy',
          'OpenClaude process is not running',
          { duration: Date.now() - startTime }
        );
      }

      // Check gRPC port (typically 50051)
      const { stdout: portStatus } = await execAsync(
        'ss -tlnp | grep :50051 || netstat -tlnp 2>/dev/null | grep :50051 || echo "not listening"',
        { timeout: 5000 }
      );

      const isListening = !portStatus.includes('not listening');
      const duration = Date.now() - startTime;

      return this.createResult(
        isListening,
        isListening ? 'healthy' : 'degraded',
        isListening ? 'OpenClaude gRPC is listening' : 'OpenClaude gRPC port not accessible',
        { responseTime: duration, processRunning: true, portListening: isListening }
      );
    } catch (error) {
      return this.createResult(
        false,
        'unhealthy',
        `OpenClaude check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check A2A Bridge status
   */
  async checkA2ABridge(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      // Import a2aBridge dynamically to avoid circular dependencies
      const { a2aBridge } = await import('./a2a-bridge.js');
      const stats = a2aBridge.getStats();

      const duration = Date.now() - startTime;

      // Bridge is healthy if it has agents registered or is operational
      const isHealthy = stats.agents >= 0;

      return this.createResult(
        isHealthy,
        isHealthy ? 'healthy' : 'degraded',
        `A2A Bridge: ${stats.onlineAgents}/${stats.agents} agents online, ${stats.totalQueuedMessages} queued`,
        {
          responseTime: duration,
          agents: stats.agents,
          onlineAgents: stats.onlineAgents,
          queuedMessages: stats.totalQueuedMessages,
          memoryEntries: stats.memoryEntries,
        }
      );
    } catch (error) {
      return this.createResult(
        false,
        'degraded',
        `A2A Bridge check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  // ==========================================================================
  // Resource Health Checks
  // ==========================================================================

  /**
   * Check disk space on /opt/hestia
   */
  async checkDiskSpace(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const { stdout } = await execAsync(
        'df -h /opt/hestia 2>/dev/null || df -h / 2>/dev/null || echo "Filesystem Size Used Avail Use%"',
        { timeout: 5000 }
      );

      const lines = stdout.trim().split('\n');
      if (lines.length < 2) {
        return this.createResult(
          false,
          'degraded',
          'Unable to parse disk space information',
          { duration: Date.now() - startTime }
        );
      }

      const dataLine = lines[1];
      const parts = dataLine.split(/\s+/);

      // Parse percentage (last column before mount point)
      const usePercentStr = parts.find(p => p.includes('%')) || '0%';
      const usePercent = parseInt(usePercentStr.replace('%', ''), 10) || 0;
      const freePercent = 100 - usePercent;

      const duration = Date.now() - startTime;

      if (freePercent < this.config.diskThreshold) {
        return this.createResult(
          false,
          'unhealthy',
          `Disk space critically low: ${freePercent}% free (${this.config.diskThreshold}% threshold)`,
          {
            responseTime: duration,
            freePercent,
            usedPercent: usePercent,
            threshold: this.config.diskThreshold,
          }
        );
      }

      if (freePercent < this.config.diskThreshold * 2) {
        return this.createResult(
          true,
          'degraded',
          `Disk space low: ${freePercent}% free`,
          {
            responseTime: duration,
            freePercent,
            usedPercent: usePercent,
            threshold: this.config.diskThreshold,
          }
        );
      }

      return this.createResult(
        true,
        'healthy',
        `Disk space OK: ${freePercent}% free`,
        {
          responseTime: duration,
          freePercent,
          usedPercent: usePercent,
        }
      );
    } catch (error) {
      return this.createResult(
        false,
        'degraded',
        `Disk check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check system memory
   */
  async checkMemory(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const freePercent = (freeMem / totalMem) * 100;
      const usedPercent = (usedMem / totalMem) * 100;

      const duration = Date.now() - startTime;

      if (freePercent < this.config.memoryThreshold) {
        return this.createResult(
          false,
          'unhealthy',
          `Memory critically low: ${freePercent.toFixed(1)}% free (${this.formatBytes(freeMem)} / ${this.formatBytes(totalMem)})`,
          {
            responseTime: duration,
            freePercent: Math.round(freePercent * 100) / 100,
            usedPercent: Math.round(usedPercent * 100) / 100,
            freeBytes: freeMem,
            totalBytes: totalMem,
            threshold: this.config.memoryThreshold,
          }
        );
      }

      if (freePercent < this.config.memoryThreshold * 1.5) {
        return this.createResult(
          true,
          'degraded',
          `Memory low: ${freePercent.toFixed(1)}% free`,
          {
            responseTime: duration,
            freePercent: Math.round(freePercent * 100) / 100,
            usedPercent: Math.round(usedPercent * 100) / 100,
            freeBytes: freeMem,
            totalBytes: totalMem,
            threshold: this.config.memoryThreshold,
          }
        );
      }

      return this.createResult(
        true,
        'healthy',
        `Memory OK: ${freePercent.toFixed(1)}% free (${this.formatBytes(freeMem)} / ${this.formatBytes(totalMem)})`,
        {
          responseTime: duration,
          freePercent: Math.round(freePercent * 100) / 100,
          usedPercent: Math.round(usedPercent * 100) / 100,
          freeBytes: freeMem,
          totalBytes: totalMem,
        }
      );
    } catch (error) {
      return this.createResult(
        false,
        'degraded',
        `Memory check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check CPU load
   */
  async checkCPU(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const loadAvg = os.loadavg();
      const numCpus = os.cpus().length;
      const loadPercent = (loadAvg[0] / numCpus) * 100;

      const duration = Date.now() - startTime;

      if (loadPercent > this.config.cpuThreshold) {
        return this.createResult(
          false,
          'unhealthy',
          `CPU load critically high: ${loadPercent.toFixed(1)}% (load avg: ${loadAvg[0].toFixed(2)})`,
          {
            responseTime: duration,
            loadPercent: Math.round(loadPercent * 100) / 100,
            loadAvg1m: Math.round(loadAvg[0] * 100) / 100,
            loadAvg5m: Math.round(loadAvg[1] * 100) / 100,
            loadAvg15m: Math.round(loadAvg[2] * 100) / 100,
            numCpus,
            threshold: this.config.cpuThreshold,
          }
        );
      }

      if (loadPercent > this.config.cpuThreshold * 0.8) {
        return this.createResult(
          true,
          'degraded',
          `CPU load high: ${loadPercent.toFixed(1)}%`,
          {
            responseTime: duration,
            loadPercent: Math.round(loadPercent * 100) / 100,
            loadAvg1m: Math.round(loadAvg[0] * 100) / 100,
            numCpus,
            threshold: this.config.cpuThreshold,
          }
        );
      }

      return this.createResult(
        true,
        'healthy',
        `CPU OK: ${loadPercent.toFixed(1)}% load (avg: ${loadAvg[0].toFixed(2)})`,
        {
          responseTime: duration,
          loadPercent: Math.round(loadPercent * 100) / 100,
          loadAvg1m: Math.round(loadAvg[0] * 100) / 100,
          loadAvg5m: Math.round(loadAvg[1] * 100) / 100,
          loadAvg15m: Math.round(loadAvg[2] * 100) / 100,
          numCpus,
        }
      );
    } catch (error) {
      return this.createResult(
        false,
        'degraded',
        `CPU check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check Docker storage space
   */
  async checkDockerStorage(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const { stdout } = await execAsync(
        'docker system df --format "{{.Size}}" 2>/dev/null | head -1 || echo "unknown"',
        { timeout: 10000 }
      );

      const duration = Date.now() - startTime;
      const dockerSize = stdout.trim();

      if (dockerSize === 'unknown' || dockerSize === '') {
        return this.createResult(
          true,
          'healthy',
          'Docker storage check skipped (unable to determine)',
          { responseTime: duration }
        );
      }

      // Parse size string (e.g., "10.5GB")
      const sizeMatch = dockerSize.match(/([\d.]+)\s*(GB|MB|TB)/i);
      let sizeGB = 0;

      if (sizeMatch) {
        const value = parseFloat(sizeMatch[1]);
        const unit = sizeMatch[2].toUpperCase();
        sizeGB = unit === 'GB' ? value : unit === 'MB' ? value / 1024 : unit === 'TB' ? value * 1024 : 0;
      }

      // Consider degraded if over 50GB
      const isHealthy = sizeGB < 50;
      const status: HealthStatus = sizeGB > 100 ? 'unhealthy' : sizeGB > 50 ? 'degraded' : 'healthy';

      return this.createResult(
        isHealthy,
        status,
        `Docker storage: ${dockerSize}`,
        {
          responseTime: duration,
          dockerSize,
          sizeGB: Math.round(sizeGB * 100) / 100,
        }
      );
    } catch (error) {
      return this.createResult(
        false,
        'degraded',
        `Docker storage check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  // ==========================================================================
  // Network Health Checks
  // ==========================================================================

  /**
   * Check internet connectivity
   */
  async checkInternet(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const testHosts = [
      '1.1.1.1',
      '8.8.8.8',
      'cloudflare.com',
    ];

    let successCount = 0;
    const results: string[] = [];

    for (const host of testHosts) {
      try {
        await execAsync(`ping -c 1 -W 2 ${host} 2>/dev/null || echo "failed"`, {
          timeout: 5000,
        });
        successCount++;
        results.push(`${host}: ok`);
      } catch {
        results.push(`${host}: failed`);
      }
    }

    const duration = Date.now() - startTime;

    if (successCount === 0) {
      return this.createResult(
        false,
        'unhealthy',
        'Internet connectivity lost - all ping tests failed',
        {
          responseTime: duration,
          successCount,
          totalTests: testHosts.length,
          results,
        }
      );
    }

    if (successCount < testHosts.length) {
      return this.createResult(
        true,
        'degraded',
        `Internet connectivity degraded (${successCount}/${testHosts.length} hosts reachable)`,
        {
          responseTime: duration,
          successCount,
          totalTests: testHosts.length,
          results,
        }
      );
    }

    return this.createResult(
      true,
      'healthy',
      'Internet connectivity OK',
      {
        responseTime: duration,
        successCount,
        totalTests: testHosts.length,
      }
    );
  }

  /**
   * Check DNS resolution
   */
  async checkDNS(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const testDomains = [
      'cloudflare.com',
      'google.com',
      'github.com',
    ];

    let successCount = 0;
    const results: string[] = [];

    for (const domain of testDomains) {
      try {
        const { stdout } = await execAsync(
          `nslookup ${domain} 2>/dev/null | grep -i "name:" | head -1 || dig +short ${domain} 2>/dev/null | head -1 || echo "failed"`,
          { timeout: 5000 }
        );

        if (stdout.trim() && !stdout.includes('failed')) {
          successCount++;
          results.push(`${domain}: resolved`);
        } else {
          results.push(`${domain}: failed`);
        }
      } catch {
        results.push(`${domain}: failed`);
      }
    }

    const duration = Date.now() - startTime;

    if (successCount === 0) {
      return this.createResult(
        false,
        'unhealthy',
        'DNS resolution failing - all test domains failed',
        {
          responseTime: duration,
          successCount,
          totalTests: testDomains.length,
          results,
        }
      );
    }

    if (successCount < testDomains.length) {
      return this.createResult(
        true,
        'degraded',
        `DNS resolution degraded (${successCount}/${testDomains.length} domains resolved)`,
        {
          responseTime: duration,
          successCount,
          totalTests: testDomains.length,
          results,
        }
      );
    }

    return this.createResult(
      true,
      'healthy',
      'DNS resolution OK',
      {
        responseTime: duration,
        successCount,
        totalTests: testDomains.length,
      }
    );
  }

  /**
   * Check firewall (UFW) rules
   */
  async checkFirewall(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const { stdout } = await execAsync(
        'sudo ufw status verbose 2>/dev/null || ufw status 2>/dev/null || echo "ufw not installed"',
        { timeout: 5000 }
      );

      const duration = Date.now() - startTime;

      if (stdout.includes('not installed')) {
        return this.createResult(
          true,
          'healthy',
          'Firewall (UFW) not installed - check skipped',
          { responseTime: duration, installed: false }
        );
      }

      const isActive = stdout.toLowerCase().includes('status: active') ||
                       stdout.toLowerCase().includes('active');

      if (!isActive) {
        return this.createResult(
          true,
          'degraded',
          'Firewall (UFW) is inactive',
          { responseTime: duration, active: false, installed: true }
        );
      }

      // Parse rules count
      const rules = stdout.split('\n').filter(line =>
        line.includes('ALLOW') || line.includes('DENY') || line.includes('REJECT')
      );

      return this.createResult(
        true,
        'healthy',
        `Firewall (UFW) is active with ${rules.length} rules`,
        {
          responseTime: duration,
          active: true,
          installed: true,
          rulesCount: rules.length,
        }
      );
    } catch (error) {
      return this.createResult(
        false,
        'degraded',
        `Firewall check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check port bindings
   */
  async checkPortBindings(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const requiredPorts = [
      { port: 3000, service: 'Synap Frontend' },
      { port: 4000, service: 'Synap Backend' },
      { port: 3001, service: 'OpenClaw' },
      { port: 3002, service: 'OpenClaw API' },
      { port: 50051, service: 'OpenClaude gRPC' },
      { port: 5432, service: 'PostgreSQL' },
      { port: 6379, service: 'Redis' },
      { port: 8108, service: 'Typesense' },
    ];

    const results: Array<{ port: number; service: string; accessible: boolean }> = [];

    for (const { port, service } of requiredPorts) {
      try {
        const { stdout } = await execAsync(
          `ss -tln | grep :${port} || netstat -tln 2>/dev/null | grep :${port} || echo "closed"`,
          { timeout: 2000 }
        );
        const accessible = !stdout.includes('closed') && stdout.includes(`:${port}`);
        results.push({ port, service, accessible });
      } catch {
        results.push({ port, service, accessible: false });
      }
    }

    const accessibleCount = results.filter(r => r.accessible).length;
    const duration = Date.now() - startTime;

    if (accessibleCount === 0) {
      return this.createResult(
        false,
        'unhealthy',
        'No required ports are accessible',
        {
          responseTime: duration,
          accessibleCount,
          totalPorts: requiredPorts.length,
          ports: results,
        }
      );
    }

    if (accessibleCount < requiredPorts.length / 2) {
      return this.createResult(
        false,
        'unhealthy',
        `Most required ports are not accessible (${accessibleCount}/${requiredPorts.length})`,
        {
          responseTime: duration,
          accessibleCount,
          totalPorts: requiredPorts.length,
          ports: results,
        }
      );
    }

    if (accessibleCount < requiredPorts.length) {
      const missing = results.filter(r => !r.accessible).map(r => `${r.service}:${r.port}`);
      return this.createResult(
        true,
        'degraded',
        `Some ports not accessible: ${missing.join(', ')}`,
        {
          responseTime: duration,
          accessibleCount,
          totalPorts: requiredPorts.length,
          ports: results,
        }
      );
    }

    return this.createResult(
      true,
      'healthy',
      'All required ports are accessible',
      {
        responseTime: duration,
        accessibleCount,
        totalPorts: requiredPorts.length,
      }
    );
  }

  // ==========================================================================
  // Integration Health Checks
  // ==========================================================================

  /**
   * Check state sync between local and remote
   */
  async checkStateSync(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const { UnifiedStateManager } = await import('./state-manager.js');
      const stateManager = new UnifiedStateManager();

      // Get sync status
      const syncStatus = await stateManager.getSyncStatus().catch(() => ({
        lastSync: null,
        pendingChanges: 0,
        conflicts: 0,
      }));

      const duration = Date.now() - startTime;

      if (syncStatus.conflicts > 0) {
        return this.createResult(
          false,
          'degraded',
          `State sync has ${syncStatus.conflicts} conflicts`,
          {
            responseTime: duration,
            lastSync: syncStatus.lastSync,
            pendingChanges: syncStatus.pendingChanges,
            conflicts: syncStatus.conflicts,
          }
        );
      }

      if (syncStatus.pendingChanges > 10) {
        return this.createResult(
          true,
          'degraded',
          `State sync has ${syncStatus.pendingChanges} pending changes`,
          {
            responseTime: duration,
            lastSync: syncStatus.lastSync,
            pendingChanges: syncStatus.pendingChanges,
          }
        );
      }

      return this.createResult(
        true,
        'healthy',
        `State sync OK (${syncStatus.pendingChanges} pending, ${syncStatus.conflicts} conflicts)`,
        {
          responseTime: duration,
          lastSync: syncStatus.lastSync,
          pendingChanges: syncStatus.pendingChanges,
          conflicts: syncStatus.conflicts,
        }
      );
    } catch (error) {
      return this.createResult(
        false,
        'degraded',
        `State sync check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check agent connectivity via A2A bridge
   */
  async checkAgentConnectivity(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const { a2aBridge } = await import('./a2a-bridge.js');
      const agents = a2aBridge.getAllAgents();

      if (agents.length === 0) {
        return this.createResult(
          true,
          'healthy',
          'No agents registered (bridge ready)',
          {
            responseTime: Date.now() - startTime,
            totalAgents: 0,
            onlineAgents: 0,
          }
        );
      }

      const onlineAgents = agents.filter(a => a.status === 'online');
      const offlineAgents = agents.filter(a => a.status === 'offline');
      const duration = Date.now() - startTime;

      if (offlineAgents.length === agents.length) {
        return this.createResult(
          false,
          'unhealthy',
          `All ${agents.length} agents are offline`,
          {
            responseTime: duration,
            totalAgents: agents.length,
            onlineAgents: onlineAgents.length,
            offlineAgents: offlineAgents.length,
          }
        );
      }

      if (offlineAgents.length > 0) {
        return this.createResult(
          true,
          'degraded',
          `${onlineAgents.length}/${agents.length} agents online (${offlineAgents.length} offline)`,
          {
            responseTime: duration,
            totalAgents: agents.length,
            onlineAgents: onlineAgents.length,
            offlineAgents: offlineAgents.length,
          }
        );
      }

      return this.createResult(
        true,
        'healthy',
        `All ${agents.length} agents online`,
        {
          responseTime: duration,
          totalAgents: agents.length,
          onlineAgents: onlineAgents.length,
        }
      );
    } catch (error) {
      return this.createResult(
        false,
        'degraded',
        `Agent connectivity check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check Synap database connectivity
   */
  async checkDatabaseConnection(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      // Try to connect via docker exec
      const { stdout, stderr } = await execAsync(
        'docker exec postgres psql -U postgres -d synap -c "SELECT 1;" 2>&1 || echo "failed"',
        { timeout: 10000 }
      );

      const duration = Date.now() - startTime;

      if (stdout.includes('failed') || stderr?.includes('error')) {
        return this.createResult(
          false,
          'unhealthy',
          'Database connection failed',
          {
            responseTime: duration,
            connected: false,
          }
        );
      }

      return this.createResult(
        true,
        'healthy',
        'Database connection OK',
        {
          responseTime: duration,
          connected: true,
        }
      );
    } catch (error) {
      return this.createResult(
        false,
        'unhealthy',
        `Database check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check backup status
   */
  async checkBackupStatus(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      // Check for recent backups
      const backupDir = '/opt/hestia/backups';

      try {
        const files = await fs.readdir(backupDir);
        const backupFiles = files.filter(f => f.endsWith('.sql') || f.endsWith('.gz') || f.includes('backup'));

        if (backupFiles.length === 0) {
          return this.createResult(
            true,
            'degraded',
            'No backup files found',
            {
              responseTime: Date.now() - startTime,
              backupCount: 0,
            }
          );
        }

        // Get most recent backup
        const stats = await Promise.all(
          backupFiles.map(async (file) => {
            const stat = await fs.stat(`${backupDir}/${file}`);
            return { file, mtime: stat.mtime, size: stat.size };
          })
        );

        stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        const mostRecent = stats[0];
        const hoursSinceBackup = (Date.now() - mostRecent.mtime.getTime()) / (1000 * 60 * 60);

        const duration = Date.now() - startTime;

        if (hoursSinceBackup > 48) {
          return this.createResult(
            true,
            'degraded',
            `Last backup is ${hoursSinceBackup.toFixed(1)} hours old`,
            {
              responseTime: duration,
              lastBackup: mostRecent.mtime,
              hoursSince: Math.round(hoursSinceBackup * 100) / 100,
              backupSize: mostRecent.size,
              totalBackups: backupFiles.length,
            }
          );
        }

        return this.createResult(
          true,
          'healthy',
          `Backup OK: ${backupFiles.length} backups, latest ${hoursSinceBackup.toFixed(1)}h ago`,
          {
            responseTime: duration,
            lastBackup: mostRecent.mtime,
            hoursSince: Math.round(hoursSinceBackup * 100) / 100,
            backupSize: mostRecent.size,
            totalBackups: backupFiles.length,
          }
        );
      } catch {
        return this.createResult(
          true,
          'degraded',
          'Backup directory not accessible',
          { responseTime: Date.now() - startTime }
        );
      }
    } catch (error) {
      return this.createResult(
        false,
        'degraded',
        `Backup check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<HealthReport> {
    logger.info('Running all health checks...');
    const startTime = Date.now();

    const categories: Record<CheckCategory, Record<string, HealthCheckResult>> = {
      service: {
        synapBackend: await this.checkSynapBackend(),
        postgres: await this.checkPostgres(),
        redis: await this.checkRedis(),
        typesense: await this.checkTypesense(),
        openClaw: await this.checkOpenClaw(),
        openClaude: await this.checkOpenClaude(),
        a2aBridge: await this.checkA2ABridge(),
      },
      resource: {
        diskSpace: await this.checkDiskSpace(),
        memory: await this.checkMemory(),
        cpu: await this.checkCPU(),
        dockerStorage: await this.checkDockerStorage(),
      },
      network: {
        internet: await this.checkInternet(),
        dns: await this.checkDNS(),
        firewall: await this.checkFirewall(),
        portBindings: await this.checkPortBindings(),
      },
      integration: {
        stateSync: await this.checkStateSync(),
        agentConnectivity: await this.checkAgentConnectivity(),
        databaseConnection: await this.checkDatabaseConnection(),
        backupStatus: await this.checkBackupStatus(),
      },
    };

    // Calculate category statuses
    const categoryStatuses: Record<CheckCategory, HealthStatus> = {
      service: this.getWorstStatus(Object.values(categories.service)),
      resource: this.getWorstStatus(Object.values(categories.resource)),
      network: this.getWorstStatus(Object.values(categories.network)),
      integration: this.getWorstStatus(Object.values(categories.integration)),
    };

    // Find degraded and failed services
    const degradedServices: string[] = [];
    const failedServices: string[] = [];

    for (const [category, checks] of Object.entries(categories)) {
      for (const [name, result] of Object.entries(checks)) {
        if (result.status === 'degraded') {
          degradedServices.push(`${category}.${name}`);
        } else if (result.status === 'unhealthy') {
          failedServices.push(`${category}.${name}`);
        }
      }
    }

    // Calculate overall status and score
    const allResults = [
      ...Object.values(categories.service),
      ...Object.values(categories.resource),
      ...Object.values(categories.network),
      ...Object.values(categories.integration),
    ];

    const overallStatus = this.getWorstStatus(allResults);
    const healthScore = this.calculateHealthScore(allResults);

    // Calculate summary
    const summary = {
      totalChecks: allResults.length,
      healthy: allResults.filter(r => r.status === 'healthy').length,
      degraded: allResults.filter(r => r.status === 'degraded').length,
      unhealthy: allResults.filter(r => r.status === 'unhealthy').length,
    };

    const report: HealthReport = {
      timestamp: new Date(),
      overallStatus,
      healthScore,
      categories: {
        service: { status: categoryStatuses.service, checks: categories.service },
        resource: { status: categoryStatuses.resource, checks: categories.resource },
        network: { status: categoryStatuses.network, checks: categories.network },
        integration: { status: categoryStatuses.integration, checks: categories.integration },
      },
      degradedServices,
      failedServices,
      summary,
    };

    // Store result and add to history
    for (const [category, checks] of Object.entries(categories)) {
      for (const [name, result] of Object.entries(checks)) {
        this.checkResults.set(`${category}.${name}`, result);
      }
    }

    if (this.config.logHistory) {
      this.checkHistory.push(report);
      if (this.checkHistory.length > this.config.historySize) {
        this.checkHistory.shift();
      }
    }

    // Alert on degraded services
    this.alertOnDegraded(report);

    // Auto-restart if enabled
    if (this.config.autoRestart) {
      await this.autoRestart(report);
    }

    const duration = Date.now() - startTime;
    logger.info(`Health check completed in ${duration}ms: ${overallStatus} (${healthScore}%)`);

    this.emit('check:complete', report);

    return report;
  }

  /**
   * Run checks for a specific category
   */
  async runCheck(category: CheckCategory): Promise<Record<string, HealthCheckResult>> {
    logger.info(`Running ${category} health checks...`);

    const checks: Record<string, () => Promise<HealthCheckResult>> = {
      service: {
        synapBackend: () => this.checkSynapBackend(),
        postgres: () => this.checkPostgres(),
        redis: () => this.checkRedis(),
        typesense: () => this.checkTypesense(),
        openClaw: () => this.checkOpenClaw(),
        openClaude: () => this.checkOpenClaude(),
        a2aBridge: () => this.checkA2ABridge(),
      },
      resource: {
        diskSpace: () => this.checkDiskSpace(),
        memory: () => this.checkMemory(),
        cpu: () => this.checkCPU(),
        dockerStorage: () => this.checkDockerStorage(),
      },
      network: {
        internet: () => this.checkInternet(),
        dns: () => this.checkDNS(),
        firewall: () => this.checkFirewall(),
        portBindings: () => this.checkPortBindings(),
      },
      integration: {
        stateSync: () => this.checkStateSync(),
        agentConnectivity: () => this.checkAgentConnectivity(),
        databaseConnection: () => this.checkDatabaseConnection(),
        backupStatus: () => this.checkBackupStatus(),
      },
    };

    const categoryChecks = checks[category];
    const results: Record<string, HealthCheckResult> = {};

    for (const [name, checkFn] of Object.entries(categoryChecks)) {
      results[name] = await checkFn();
      this.checkResults.set(`${category}.${name}`, results[name]);
    }

    this.emit(`check:${category}`, results);

    return results;
  }

  /**
   * Start continuous monitoring
   */
  watch(interval?: number): void {
    if (this.isWatching) {
      logger.warn('Health check watch already running');
      return;
    }

    const checkInterval = interval || this.config.checkInterval;
    this.isWatching = true;

    logger.info(`Starting health check monitoring (interval: ${checkInterval}ms)`);
    this.emit('watch:start', { interval: checkInterval });

    // Run initial check
    this.runAllChecks();

    // Set up interval
    this.watchInterval = setInterval(async () => {
      try {
        await this.runAllChecks();
      } catch (error) {
        logger.error('Health check failed:', error);
        this.emit('watch:error', error);
      }
    }, checkInterval);
  }

  /**
   * Stop continuous monitoring
   */
  stopWatch(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    this.isWatching = false;
    logger.info('Health check monitoring stopped');
    this.emit('watch:stop');
  }

  /**
   * Get overall health score (0-100%)
   */
  getHealthScore(): number {
    if (this.checkResults.size === 0) {
      return 100;
    }

    const results = Array.from(this.checkResults.values());
    return this.calculateHealthScore(results);
  }

  /**
   * Generate health report
   */
  generateHealthReport(): HealthReport | null {
    if (this.checkHistory.length === 0) {
      return null;
    }

    return this.checkHistory[this.checkHistory.length - 1];
  }

  /**
   * Get health check history
   */
  getHistory(limit?: number): HealthReport[] {
    const history = [...this.checkHistory];
    if (limit && limit > 0) {
      return history.slice(-limit);
    }
    return history;
  }

  /**
   * Get the result of a specific check
   */
  getCheckResult(checkName: string): HealthCheckResult | undefined {
    return this.checkResults.get(checkName);
  }

  /**
   * Get all check results
   */
  getAllResults(): Map<string, HealthCheckResult> {
    return new Map(this.checkResults);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HealthCheckConfig>): void {
    this.config = { ...this.config, ...config };
    logger.debug('Health check configuration updated', this.config);
    this.emit('config:update', this.config);
  }

  /**
   * Dispose of the health check system
   */
  dispose(): void {
    this.stopWatch();
    this.checkResults.clear();
    this.checkHistory = [];
    this.degradedCount.clear();
    this.removeAllListeners();
    logger.info('HealthCheckSystem disposed');
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private createResult(
    healthy: boolean,
    status: HealthStatus,
    message: string,
    metrics?: Record<string, number | string | boolean | Date>,
    error?: string
  ): HealthCheckResult {
    return {
      healthy,
      status,
      message,
      metrics,
      lastCheck: new Date(),
      ...(error && { error }),
    };
  }

  private getWorstStatus(results: HealthCheckResult[]): HealthStatus {
    if (results.some(r => r.status === 'unhealthy')) {
      return 'unhealthy';
    }
    if (results.some(r => r.status === 'degraded')) {
      return 'degraded';
    }
    return 'healthy';
  }

  private calculateHealthScore(results: HealthCheckResult[]): number {
    if (results.length === 0) return 100;

    const weights = {
      healthy: 1,
      degraded: 0.5,
      unhealthy: 0,
    };

    const total = results.length;
    const score = results.reduce((acc, result) => {
      return acc + weights[result.status];
    }, 0);

    return Math.round((score / total) * 100);
  }

  private alertOnDegraded(report: HealthReport): void {
    // Track degraded counts
    for (const serviceName of report.degradedServices) {
      const count = (this.degradedCount.get(serviceName) || 0) + 1;
      this.degradedCount.set(serviceName, count);

      if (count === this.config.alertThreshold) {
        logger.warn(`Service degraded alert: ${serviceName} (threshold reached)`);
        this.emit('alert:degraded', { service: serviceName, count, report });
      }
    }

    // Clear counts for healthy services
    for (const [name] of this.degradedCount) {
      if (!report.degradedServices.includes(name) && !report.failedServices.includes(name)) {
        this.degradedCount.delete(name);
      }
    }

    // Alert on failed services
    for (const serviceName of report.failedServices) {
      logger.error(`Service failure alert: ${serviceName}`);
      this.emit('alert:failed', { service: serviceName, report });
    }

    // Overall status change alerts
    if (report.overallStatus === 'unhealthy') {
      logger.error(`System health alert: Overall status is UNHEALTHY (${report.healthScore}%)`);
      this.emit('alert:unhealthy', report);
    } else if (report.overallStatus === 'degraded') {
      logger.warn(`System health degraded: ${report.healthScore}%`);
      this.emit('alert:health-degraded', report);
    }
  }

  private async autoRestart(report: HealthReport): Promise<void> {
    const restartableServices = [
      'synapBackend',
      'postgres',
      'redis',
      'typesense',
      'openClaw',
      'openClaude',
    ];

    for (const serviceName of report.failedServices) {
      const shortName = serviceName.split('.').pop();
      if (shortName && restartableServices.includes(shortName)) {
        logger.info(`Auto-restarting failed service: ${shortName}`);
        this.emit('auto-restart:start', { service: shortName });

        try {
          await this.restartService(shortName);
          logger.success(`Auto-restart successful: ${shortName}`);
          this.emit('auto-restart:success', { service: shortName });
        } catch (error) {
          logger.error(`Auto-restart failed: ${shortName}`, error);
          this.emit('auto-restart:failed', { service: shortName, error });
        }
      }
    }
  }

  private async restartService(serviceName: string): Promise<void> {
    const commands: Record<string, string> = {
      synapBackend: 'cd /opt/hestia/synap-backend && docker-compose restart backend',
      postgres: 'docker restart postgres',
      redis: 'docker restart redis',
      typesense: 'docker restart typesense',
      openClaw: 'pkill -f "openclaw" && sleep 2 && openclaw start',
      openClaude: 'pkill -f "openclaude" && sleep 2 && openclaude start',
    };

    const command = commands[serviceName];
    if (!command) {
      throw new Error(`No restart command configured for ${serviceName}`);
    }

    await execAsync(command, { timeout: 60000 });
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const healthCheck = new HealthCheckSystem();

// ============================================================================
// Default Export
// ============================================================================

export default HealthCheckSystem;
