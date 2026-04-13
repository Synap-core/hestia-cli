/**
 * Credentials Manager - Handles secure storage of API keys and tokens
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Credentials } from './types.js';

/** File permissions for credentials file (user read/write only) */
const CREDENTIALS_FILE_MODE = 0o600;

/** Manages secure storage of credentials */
export class CredentialsManager {
  private credentials: Credentials | null = null;
  private credentialsPath: string | null = null;

  /**
   * Get the path to the credentials file
   */
  getCredentialsPath(): string {
    if (this.credentialsPath) {
      return this.credentialsPath;
    }
    return join(homedir(), '.config', 'hestia', 'credentials');
  }

  /**
   * Set a custom credentials path (useful for testing)
   */
  setCredentialsPath(path: string): void {
    this.credentialsPath = path;
  }

  /**
   * Ensure the credentials directory exists with proper permissions
   */
  private async ensureCredentialsDir(): Promise<void> {
    const credsDir = join(homedir(), '.config', 'hestia');
    try {
      await fs.mkdir(credsDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      // Directory might already exist, that's ok
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new Error(`Failed to create credentials directory: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Load credentials from disk
   * Returns empty object if no credentials exist
   */
  async loadCredentials(): Promise<Credentials> {
    try {
      await this.ensureCredentialsDir();
      const credsPath = this.getCredentialsPath();
      
      try {
        const content = await fs.readFile(credsPath, 'utf-8');
        const parsed = JSON.parse(content) as Credentials;
        
        // Basic validation
        if (typeof parsed !== 'object' || parsed === null) {
          throw new Error('Invalid credentials format');
        }
        
        this.credentials = parsed;
        return this.credentials;
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          // Credentials don't exist yet
          this.credentials = {};
          return this.credentials;
        }
        if (readError instanceof SyntaxError) {
          throw new Error('Credentials file is corrupted (invalid JSON)');
        }
        throw readError;
      }
    } catch (error) {
      throw new Error(`Failed to load credentials: ${(error as Error).message}`);
    }
  }

  /**
   * Save credentials to disk with restricted permissions
   */
  async saveCredentials(creds: Credentials): Promise<void> {
    try {
      await this.ensureCredentialsDir();
      const credsPath = this.getCredentialsPath();
      
      const content = JSON.stringify(creds, null, 2);
      
      // Write file with restricted permissions
      await fs.writeFile(credsPath, content, {
        encoding: 'utf-8',
        mode: CREDENTIALS_FILE_MODE,
      });
      
      // Ensure permissions on existing files
      try {
        await fs.chmod(credsPath, CREDENTIALS_FILE_MODE);
      } catch {
        // Ignore chmod errors on Windows or if file doesn't exist
      }
      
      this.credentials = creds;
    } catch (error) {
      throw new Error(`Failed to save credentials: ${(error as Error).message}`);
    }
  }

  /**
   * Get a single credential by key
   */
  async getCredential(key: string): Promise<string | undefined> {
    const creds = await this.loadCredentials();
    return creds[key];
  }

  /**
   * Set a single credential
   */
  async setCredential(key: string, value: string): Promise<void> {
    const creds = await this.loadCredentials();
    creds[key] = value;
    await this.saveCredentials(creds);
  }

  /**
   * Delete a single credential
   */
  async deleteCredential(key: string): Promise<void> {
    const creds = await this.loadCredentials();
    delete creds[key];
    await this.saveCredentials(creds);
  }

  /**
   * Check if a credential exists
   */
  async hasCredential(key: string): Promise<boolean> {
    const creds = await this.loadCredentials();
    return key in creds;
  }

  /**
   * List all credential keys (values are hidden)
   */
  async listCredentialKeys(): Promise<string[]> {
    const creds = await this.loadCredentials();
    return Object.keys(creds);
  }

  /**
   * Clear all credentials (use with caution!)
   */
  async clearAll(): Promise<void> {
    await this.saveCredentials({});
  }

  /**
   * Get cached credentials without reloading
   */
  getCachedCredentials(): Credentials | null {
    return this.credentials;
  }
}

/** Singleton instance */
export const credentialsManager = new CredentialsManager();
