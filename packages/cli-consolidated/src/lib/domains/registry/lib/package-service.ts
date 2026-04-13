/**
 * Hestia CLI - Package Service
 *
 * Manages package lifecycle: install, start, stop, update, remove.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as yaml from "yaml";
import { spawn } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import type {
  Package,
  PackageInstance,
  HestiaConfig,
  Logger,
  ProgressReporter,
} from '../../lib/types/index';

const execAsync = promisify(exec);

interface PackageServiceConfig {
  packagesDir: string;
  config: HestiaConfig;
  logger: Logger;
}

interface DockerComposeConfig {
  version: string;
  services: Record<
    string,
    {
      image: string;
      container_name?: string;
      ports?: string[];
      volumes?: string[];
      environment?: Record<string, string>;
      networks?: string[];
      restart?: string;
      healthcheck?: {
        test: string[];
        interval: string;
        timeout: string;
        retries: number;
      };
    }
  >;
  networks?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
}

export class PackageService {
  private config: PackageServiceConfig;

  constructor(config: PackageServiceConfig) {
    this.config = config;
  }

  // ============ INSTALLATION ============

  async install(
    pkg: Package,
    progress?: ProgressReporter
  ): Promise<PackageInstance> {
    this.config.logger.info(`Installing package: ${pkg.name}@${pkg.version}`);
    progress?.start(5, `Installing ${pkg.name}...`);

    try {
      // Step 1: Download package files
      progress?.update(1, "Downloading package...");
      const packageDir = await this.downloadPackage(pkg);

      // Step 2: Validate package
      progress?.update(2, "Validating package...");
      await this.validatePackage(pkg, packageDir);

      // Step 3: Check dependencies
      progress?.update(3, "Checking dependencies...");
      await this.checkDependencies(pkg);

      // Step 4: Configure package
      progress?.update(4, "Configuring package...");
      await this.configurePackage(pkg, packageDir);

      // Step 5: Install based on type
      progress?.update(5, "Installing...");
      const instance = await this.installByType(pkg, packageDir);

      progress?.finish(`${pkg.name} installed successfully`);
      return instance;
    } catch (error) {
      progress?.fail(
        `Failed to install ${pkg.name}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      throw error;
    }
  }

  private async downloadPackage(pkg: Package): Promise<string> {
    const packageDir = path.join(
      this.config.packagesDir,
      pkg.name,
      pkg.version
    );

    await fs.mkdir(packageDir, { recursive: true });

    // Download based on source type
    switch (pkg.source.type) {
      case "docker_compose":
        // Download docker-compose.yml
        await this.downloadFile(
          `${pkg.source.url}/${pkg.source.composeFile || "docker-compose.yml"}`,
          path.join(packageDir, "docker-compose.yml")
        );
        break;

      case "binary":
        // Download binary
        await this.downloadFile(
          pkg.source.url,
          path.join(packageDir, pkg.name)
        );
        break;

      case "npm":
        // npm install
        await execAsync(`npm install ${pkg.source.url}`, {
          cwd: packageDir,
        });
        break;

      case "git":
        // git clone
        await execAsync(`git clone ${pkg.source.url} .`, {
          cwd: packageDir,
        });
        break;

      default:
        throw new Error(`Unknown source type: ${pkg.source.type}`);
    }

    // Save package manifest
    await fs.writeFile(
      path.join(packageDir, "package.yaml"),
      yaml.stringify(pkg),
      "utf-8"
    );

    return packageDir;
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.status}`);
    }
    const content = await response.text();
    await fs.writeFile(dest, content, "utf-8");
  }

  private async validatePackage(
    pkg: Package,
    packageDir: string
  ): Promise<void> {
    // Check required files exist
    if (pkg.source.type === "docker_compose") {
      const composePath = path.join(packageDir, "docker-compose.yml");
      try {
        await fs.access(composePath);
      } catch {
        throw new Error("docker-compose.yml not found in package");
      }

      // Validate YAML syntax
      const content = await fs.readFile(composePath, "utf-8");
      yaml.parse(content); // Will throw if invalid
    }
  }

  private async checkDependencies(pkg: Package): Promise<void> {
    if (!pkg.requires) return;

    for (const dep of pkg.requires) {
      const depConfig = this.config.config.packages[dep.name];
      if (!depConfig?.enabled && !dep.optional) {
        throw new Error(
          `Required dependency not installed: ${dep.name}@${dep.versionRange}`
        );
      }
    }
  }

  private async configurePackage(
    pkg: Package,
    packageDir: string
  ): Promise<void> {
    const config = this.config.config.packages[pkg.name]?.config || {};

    // Write configuration file
    await fs.writeFile(
      path.join(packageDir, "config.yaml"),
      yaml.stringify(config),
      "utf-8"
    );

    // Generate environment file
    const envVars = this.generateEnvVars(pkg, config);
    await fs.writeFile(
      path.join(packageDir, ".env"),
      envVars,
      "utf-8"
    );
  }

  private generateEnvVars(
    pkg: Package,
    config: Record<string, unknown>
  ): string {
    const env: Record<string, string> = {
      HESTIA_PACKAGE_NAME: pkg.name,
      HESTIA_PACKAGE_VERSION: pkg.version,
      ...this.flattenConfig(config),
    };

    return Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
  }

  private flattenConfig(
    obj: Record<string, unknown>,
    prefix = ""
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}_${key.toUpperCase()}` : key.toUpperCase();

      if (typeof value === "object" && value !== null) {
        Object.assign(result, this.flattenConfig(value as Record<string, unknown>, newKey));
      } else {
        result[newKey] = String(value);
      }
    }

    return result;
  }

  private async installByType(
    pkg: Package,
    packageDir: string
  ): Promise<PackageInstance> {
    const now = new Date();

    switch (pkg.source.type) {
      case "docker_compose":
        await this.runDockerCompose(packageDir, "pull");
        break;

      case "binary":
        // Make binary executable
        const binaryPath = path.join(packageDir, pkg.name);
        await fs.chmod(binaryPath, 0o755);
        break;

      case "npm":
        // Already installed during download
        break;

      case "git":
        // Run install script if exists
        const installScript = path.join(packageDir, "install.sh");
        try {
          await fs.access(installScript);
          await execAsync("./install.sh", { cwd: packageDir });
        } catch {
          // No install script, skip
        }
        break;
    }

    return {
      id: `${pkg.name}-${Date.now()}`,
      packageName: pkg.name,
      version: pkg.version,
      status: "installed",
      config: this.config.config.packages[pkg.name]?.config || {},
      installedAt: now,
      lastUpdated: now,
    };
  }

  // ============ LIFECYCLE ============

  async start(packageName: string): Promise<void> {
    const packageDir = await this.getPackageDir(packageName);
    const pkg = await this.loadPackageManifest(packageDir);

    this.config.logger.info(`Starting package: ${packageName}`);

    switch (pkg.source.type) {
      case "docker_compose":
        await this.runDockerCompose(packageDir, "up -d");
        break;

      case "binary":
        // Start binary as service (use systemd or process manager)
        await this.startBinaryService(packageName, packageDir);
        break;

      case "npm":
        await execAsync("npm start", { cwd: packageDir });
        break;

      case "git":
        // Run start script if exists
        try {
          await execAsync("./start.sh", { cwd: packageDir });
        } catch {
          throw new Error(`Package ${packageName} has no start script`);
        }
        break;
    }

    await this.updateInstanceStatus(packageName, "running");
  }

  async stop(packageName: string): Promise<void> {
    const packageDir = await this.getPackageDir(packageName);
    const pkg = await this.loadPackageManifest(packageDir);

    this.config.logger.info(`Stopping package: ${packageName}`);

    switch (pkg.source.type) {
      case "docker_compose":
        await this.runDockerCompose(packageDir, "down");
        break;

      case "binary":
        await this.stopBinaryService(packageName);
        break;

      case "npm":
        await execAsync("npm stop", { cwd: packageDir });
        break;

      case "git":
        try {
          await execAsync("./stop.sh", { cwd: packageDir });
        } catch {
          // Ignore errors on stop
        }
        break;
    }

    await this.updateInstanceStatus(packageName, "stopped");
  }

  async restart(packageName: string): Promise<void> {
    await this.stop(packageName);
    await this.start(packageName);
  }

  async update(packageName: string, version: string): Promise<PackageInstance> {
    // Get current package
    const currentInstance = await this.getInstance(packageName);
    if (!currentInstance) {
      throw new Error(`Package not installed: ${packageName}`);
    }

    // Stop current version
    if (currentInstance.status === "running") {
      await this.stop(packageName);
    }

    // Get package registry info
    const registry = await this.loadRegistry();
    const pkg = registry.packages[packageName];
    if (!pkg) {
      throw new Error(`Package not found in registry: ${packageName}`);
    }

    // Update version
    pkg.version = version;

    // Re-install
    const instance = await this.install(pkg);

    return instance;
  }

  async remove(packageName: string): Promise<void> {
    const instance = await this.getInstance(packageName);
    if (!instance) {
      throw new Error(`Package not installed: ${packageName}`);
    }

    // Stop if running
    if (instance.status === "running") {
      await this.stop(packageName);
    }

    // Remove package directory
    const packageDir = await this.getPackageDir(packageName);
    await fs.rm(packageDir, { recursive: true, force: true });

    this.config.logger.info(`Package removed: ${packageName}`);
  }

  // ============ STATUS & INFO ============

  async status(packageName: string): Promise<PackageInstance> {
    const instance = await this.getInstance(packageName);
    if (!instance) {
      throw new Error(`Package not installed: ${packageName}`);
    }

    // Check actual health status
    const health = await this.checkHealth(packageName);
    instance.health = {
      status: health.status,
      lastCheck: new Date(),
      message: health.message,
    };

    return instance;
  }

  async list(): Promise<PackageInstance[]> {
    const instances: PackageInstance[] = [];

    try {
      const packagesDir = this.config.packagesDir;
      const entries = await fs.readdir(packagesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const instance = await this.getInstance(entry.name);
            if (instance) {
              instances.push(instance);
            }
          } catch {
            // Skip invalid packages
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return instances;
  }

  // ============ PRIVATE HELPERS ============

  private async runDockerCompose(
    packageDir: string,
    command: string
  ): Promise<void> {
    const composeFile = path.join(packageDir, "docker-compose.yml");
    const { stdout, stderr } = await execAsync(
      `docker compose -f ${composeFile} ${command}`,
      { cwd: packageDir }
    );

    if (stderr && !stderr.includes("Network")) {
      this.config.logger.warn(`Docker compose warning: ${stderr}`);
    }
  }

  private async startBinaryService(
    packageName: string,
    packageDir: string
  ): Promise<void> {
    // Create systemd service or use pm2
    const binaryPath = path.join(packageDir, packageName);
    const serviceFile = `/etc/systemd/system/hestia-${packageName}.service`;

    const serviceContent = `
[Unit]
Description=Hestia ${packageName}
After=network.target

[Service]
Type=simple
ExecStart=${binaryPath}
WorkingDirectory=${packageDir}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;

    // Write service file (requires sudo)
    await execAsync(`echo '${serviceContent}' | sudo tee ${serviceFile}`);
    await execAsync(`sudo systemctl enable hestia-${packageName}`);
    await execAsync(`sudo systemctl start hestia-${packageName}`);
  }

  private async stopBinaryService(packageName: string): Promise<void> {
    await execAsync(`sudo systemctl stop hestia-${packageName}`);
  }

  private async checkHealth(packageName: string): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
  }> {
    const packageDir = await this.getPackageDir(packageName);
    const pkg = await this.loadPackageManifest(packageDir);

    if (pkg.source.type === "docker_compose") {
      try {
        const { stdout } = await execAsync(
          `docker compose -f ${path.join(
            packageDir,
            "docker-compose.yml"
          )} ps --format json`,
          { cwd: packageDir }
        );
        const services = JSON.parse(stdout || "[]");

        const running = services.filter((s: { State: string }) =>
          s.State?.includes("running")
        ).length;
        const total = services.length;

        if (running === total) {
          return { status: "healthy", message: `All ${total} services running` };
        } else if (running > 0) {
          return {
            status: "degraded",
            message: `${running}/${total} services running`,
          };
        } else {
          return { status: "unhealthy", message: "No services running" };
        }
      } catch (error) {
        return {
          status: "unhealthy",
          message: error instanceof Error ? error.message : "Health check failed",
        };
      }
    }

    // For other types, assume healthy if process exists
    return { status: "healthy" };
  }

  private async getPackageDir(packageName: string): Promise<string> {
    const packageDir = path.join(this.config.packagesDir, packageName);
    try {
      await fs.access(packageDir);
      return packageDir;
    } catch {
      throw new Error(`Package not found: ${packageName}`);
    }
  }

  private async loadPackageManifest(packageDir: string): Promise<Package> {
    const manifestPath = path.join(packageDir, "package.yaml");
    const content = await fs.readFile(manifestPath, "utf-8");
    return yaml.parse(content) as Package;
  }

  private async getInstance(packageName: string): Promise<PackageInstance | null> {
    try {
      const packageDir = await this.getPackageDir(packageName);
      const manifest = await this.loadPackageManifest(packageDir);

      // Get current status
      let status: PackageInstance["status"] = "installed";
      try {
        const health = await this.checkHealth(packageName);
        status = health.status === "healthy" ? "running" : "stopped";
      } catch {
        status = "error";
      }

      return {
        id: `${packageName}-instance`,
        packageName: manifest.name,
        version: manifest.version,
        status,
        config: this.config.config.packages[packageName]?.config || {},
        installedAt: new Date(),
        lastUpdated: new Date(),
      };
    } catch {
      return null;
    }
  }

  private async updateInstanceStatus(
    packageName: string,
    status: PackageInstance["status"]
  ): Promise<void> {
    // Update status in package manifest
    const packageDir = await this.getPackageDir(packageName);
    const manifest = await this.loadPackageManifest(packageDir);

    // This would typically update a state file
    // For now, we'll rely on docker compose ps or process checks
    this.config.logger.debug(`Package ${packageName} status: ${status}`);
  }

  private async loadRegistry(): Promise<{ packages: Record<string, Package> }> {
    // Load from registry cache or fetch from remote
    const registryPath = path.join(
      this.config.packagesDir,
      "..",
      "registry-cache.yaml"
    );

    try {
      const content = await fs.readFile(registryPath, "utf-8");
      return yaml.parse(content) as { packages: Record<string, Package> };
    } catch {
      return { packages: {} };
    }
  }
}
