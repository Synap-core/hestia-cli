/**
 * Environment File Generator
 * Generates .env file with all required secrets and configuration
 */

import { randomBytes } from 'crypto';

interface EnvGenerateOptions {
  domain: string;
  profile: 'minimal' | 'full' | 'ai-heavy';
  provider: 'opencode' | 'openclaude' | 'both' | 'none';
}

export async function generateEnvFile(options: EnvGenerateOptions): Promise<string> {
  const secrets = generateSecrets();
  
  const envVars: Record<string, string> = {
    // Domain & SSL
    DOMAIN: options.domain,
    LETSENCRYPT_EMAIL: `admin@${options.domain}`,
    
    // Database
    POSTGRES_PASSWORD: secrets.postgresPassword,
    
    // MinIO
    MINIO_ACCESS_KEY: secrets.minioAccessKey,
    MINIO_SECRET_KEY: secrets.minioSecretKey,
    
    // Typesense
    TYPESENSE_API_KEY: secrets.typesenseApiKey,
    TYPESENSE_ADMIN_API_KEY: secrets.typesenseAdminApiKey,
    
    // Synap
    JWT_SECRET: secrets.jwtSecret,
    HUB_PROTOCOL_API_KEY: secrets.hubProtocolApiKey,
    SYNAP_SERVICE_ENCRYPTION_KEY: secrets.serviceEncryptionKey,
    
    // Hub
    HUB_JWT_SECRET: secrets.hubJwtSecret,
    
    // Session
    SESSION_SECRET: secrets.sessionSecret
  };

  // Add AI provider specific vars
  if (options.provider === 'opencode' || options.provider === 'both') {
    envVars.OPENCODE_MODEL = 'anthropic/claude-sonnet-4-6';
    envVars.ANTHROPIC_API_KEY = '${ANTHROPIC_API_KEY:-}';
  }

  if (options.provider === 'openclaude' || options.provider === 'both') {
    envVars.OPENCLAW_MODEL = 'anthropic/claude-sonnet-4-6';
    envVars.OPENCLAW_HUB_API_KEY = secrets.openclawHubApiKey;
    envVars.SYNAP_AGENT_USER_ID = '${SYNAP_AGENT_USER_ID:-}';
    envVars.SYNAP_WORKSPACE_ID = 'default';
  }

  // Optional API keys
  envVars.OPENAI_API_KEY = '${OPENAI_API_KEY:-}';
  envVars.ANTHROPIC_API_KEY = '${ANTHROPIC_API_KEY:-}';
  envVars.GOOGLE_AI_API_KEY = '${GOOGLE_AI_API_KEY:-}';

  // Profile-specific vars
  if (options.profile === 'ai-heavy') {
    envVars.TYPESENSE_MEMORY = '2g';
    envVars.POSTGRES_MEMORY = '4g';
  }

  // Generate .env content
  const lines = [
    '# Hestia Environment Configuration',
    `# Generated for ${options.domain}`,
    '',
    '# ===========================================',
    '# DOMAIN & SSL',
    '# ===========================================',
    ...formatVars(envVars, ['DOMAIN', 'LETSENCRYPT_EMAIL']),
    '',
    '# ===========================================',
    '# DATABASE',
    '# ===========================================',
    ...formatVars(envVars, ['POSTGRES_PASSWORD']),
    '',
    '# ===========================================',
    '# OBJECT STORAGE (MinIO)',
    '# ===========================================',
    ...formatVars(envVars, ['MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY']),
    '',
    '# ===========================================',
    '# SEARCH (Typesense)',
    '# ===========================================',
    ...formatVars(envVars, ['TYPESENSE_API_KEY', 'TYPESENSE_ADMIN_API_KEY']),
    '',
    '# ===========================================',
    '# SYNAP CORE',
    '# ===========================================',
    ...formatVars(envVars, ['JWT_SECRET', 'HUB_PROTOCOL_API_KEY', 'SYNAP_SERVICE_ENCRYPTION_KEY', 'HUB_JWT_SECRET']),
    '',
    '# ===========================================',
    '# AI PROVIDERS (Fill in your API keys)',
    '# ===========================================',
    ...formatVars(envVars, ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY']),
    '',
  ];

  if (options.provider === 'opencode' || options.provider === 'both') {
    lines.push(
      '# ===========================================',
      '# OPENCODE CONFIGURATION',
      '# ===========================================',
      ...formatVars(envVars, ['OPENCODE_MODEL']),
      ''
    );
  }

  if (options.provider === 'openclaude' || options.provider === 'both') {
    lines.push(
      '# ===========================================',
      '# OPENCLAW/OPENCLAUDE CONFIGURATION',
      '# ===========================================',
      ...formatVars(envVars, ['OPENCLAW_MODEL', 'OPENCLAW_HUB_API_KEY', 'SYNAP_AGENT_USER_ID', 'SYNAP_WORKSPACE_ID']),
      ''
    );
  }

  return lines.join('\n');
}

function generateSecrets() {
  return {
    postgresPassword: generatePassword(32),
    minioAccessKey: generatePassword(20),
    minioSecretKey: generatePassword(40),
    typesenseApiKey: generatePassword(32),
    typesenseAdminApiKey: generatePassword(32),
    jwtSecret: generateSecret(64),
    hubProtocolApiKey: generateSecret(64),
    serviceEncryptionKey: generateSecret(64),
    hubJwtSecret: generateSecret(64),
    sessionSecret: generateSecret(64),
    openclawHubApiKey: generateSecret(64)
  };
}

function generatePassword(length: number): string {
  return randomBytes(length).toString('base64').slice(0, length).replace(/[^a-zA-Z0-9]/g, 'X');
}

function generateSecret(length: number): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

function formatVars(vars: Record<string, string>, keys: string[]): string[] {
  return keys.map(key => `${key}=${vars[key] || ''}`);
}
