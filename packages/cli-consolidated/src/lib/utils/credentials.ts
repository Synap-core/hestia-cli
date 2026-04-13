/**
 * Credentials Management
 * Secure storage of sensitive configuration
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'js-yaml';
import { logger } from './logger.js';

const CONFIG_DIR = process.env.HESTIA_CONFIG_DIR || path.join(os.homedir(), '.hestia');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.yaml');

/**
 * Load credentials from secure file
 */
export async function loadCredentials(): Promise<Record<string, string>> {
  try {
    await fs.access(CREDENTIALS_FILE);
    const content = await fs.readFile(CREDENTIALS_FILE, 'utf-8');
    const parsed = YAML.load(content) as Record<string, string>;
    return parsed || {};
  } catch {
    return {};
  }
}

/**
 * Save credentials to secure file (permissions 0600)
 */
export async function saveCredentials(credentials: Record<string, string>): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const yaml = YAML.dump(credentials, { indent: 2 });
  await fs.writeFile(CREDENTIALS_FILE, yaml, { mode: 0o600 });
}

/**
 * Get a specific credential
 */
export async function getCredential(key: string): Promise<string | undefined> {
  const credentials = await loadCredentials();
  return credentials[key];
}

/**
 * Set a specific credential
 */
export async function setCredential(key: string, value: string): Promise<void> {
  const credentials = await loadCredentials();
  credentials[key] = value;
  await saveCredentials(credentials);
  logger.debug(`Credential ${key} saved`);
}

/**
 * Remove a credential
 */
export async function removeCredential(key: string): Promise<void> {
  const credentials = await loadCredentials();
  delete credentials[key];
  await saveCredentials(credentials);
  logger.debug(`Credential ${key} removed`);
}

/**
 * List all credential keys (without values)
 */
export async function listCredentials(): Promise<string[]> {
  const credentials = await loadCredentials();
  return Object.keys(credentials);
}

/**
 * Check if credential exists
 */
export async function hasCredential(key: string): Promise<boolean> {
  const value = await getCredential(key);
  return value !== undefined && value.trim() !== '';
}

/**
 * Validate credentials format
 */
export function validateCredential(key: string, value: string): { valid: boolean; message?: string } {
  switch (key) {
    case 'apiKey':
      if (!value.startsWith('sk-') && !value.startsWith('pk-')) {
        return { valid: false, message: 'API key should start with sk- or pk-' };
      }
      if (value.length < 20) {
        return { valid: false, message: 'API key seems too short' };
      }
      break;
    case 'email':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return { valid: false, message: 'Invalid email format' };
      }
      break;
    case 'url':
    case 'podUrl':
      try {
        new URL(value);
      } catch {
        return { valid: false, message: 'Invalid URL format' };
      }
      break;
  }
  
  return { valid: true };
}

/**
 * Get all credentials (use with caution)
 */
export async function getAllCredentials(): Promise<Record<string, string>> {
  return loadCredentials();
}

/**
 * Clear all credentials
 */
export async function clearAllCredentials(): Promise<void> {
  await saveCredentials({});
  logger.info('All credentials cleared');
}

// Export alias for backward compatibility
export { getCredential as getCredentials };
