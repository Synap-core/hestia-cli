/**
 * Domain Service
 * Handles domain configuration, DNS, and SSL
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

interface DomainConfig {
  domain: string;
  provider: 'traefik' | 'caddy' | 'coolify';
  deployDir: string;
  email?: string;
}

export async function configureDomain(config: DomainConfig): Promise<{ 
  success: boolean; 
  message: string;
  ips?: string[];
}> {
  try {
    // Check domain resolves
    const resolution = await checkDomainResolution(config.domain);
    
    if (!resolution.resolves) {
      logger.warn(`Domain ${config.domain} does not resolve to this server`);
      logger.info(`Please configure DNS:`);
      logger.info(`  A record: ${config.domain} → ${resolution.serverIp}`);
      logger.info(`  A record: *.${config.domain} → ${resolution.serverIp}`);
    }

    // Generate provider-specific config
    switch (config.provider) {
      case 'traefik':
        await configureTraefik(config);
        break;
      case 'caddy':
        await configureCaddy(config);
        break;
      case 'coolify':
        await configureCoolify(config);
        break;
    }

    return {
      success: true,
      message: `Domain ${config.domain} configured with ${config.provider}`,
      ips: resolution.serverIp ? [resolution.serverIp] : undefined
    };

  } catch (error: any) {
    return {
      success: false,
      message: `Failed to configure domain: ${error.message}`
    };
  }
}

async function checkDomainResolution(domain: string): Promise<{
  resolves: boolean;
  serverIp?: string;
  domainIp?: string;
}> {
  try {
    // Get server IP
    const { stdout: serverIp } = await execAsync(
      "curl -s ifconfig.me || curl -s icanhazip.com || echo 'unknown'"
    );
    
    // Get domain IP
    try {
      const { stdout: domainIp } = await execAsync(`dig +short ${domain} | head -1`);
      return {
        resolves: domainIp.trim() === serverIp.trim(),
        serverIp: serverIp.trim(),
        domainIp: domainIp.trim()
      };
    } catch {
      return {
        resolves: false,
        serverIp: serverIp.trim()
      };
    }
  } catch {
    return { resolves: false };
  }
}

async function configureTraefik(config: DomainConfig): Promise<void> {
  // Traefik is configured via Docker labels in docker-compose
  // This function creates additional config if needed
  const traefikDir = path.join(config.deployDir, 'traefik');
  await fs.mkdir(traefikDir, { recursive: true });

  // Create dynamic config for middlewares
  const dynamicConfig = {
    http: {
      middlewares: {
        'security-headers': {
          headers: {
            customRequestHeaders: {
              'X-Forwarded-Proto': 'https'
            },
            customResponseHeaders: {
              'X-Frame-Options': 'SAMEORIGIN',
              'X-Content-Type-Options': 'nosniff',
              'X-XSS-Protection': '1; mode=block',
              'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
            }
          }
        },
        compression: {
          compress: {}
        }
      }
    }
  };

  await fs.writeFile(
    path.join(traefikDir, 'dynamic.yml'),
    JSON.stringify(dynamicConfig, null, 2)
  );
}

async function configureCaddy(config: DomainConfig): Promise<void> {
  const caddyfile = `${config.domain} {
  reverse_proxy synap-backend:4000
  
  tls ${config.email || 'internal'}
  
  header {
    X-Frame-Options "SAMEORIGIN"
    X-Content-Type-Options "nosniff"
    X-XSS-Protection "1; mode=block"
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
  }
}

dev.${config.domain} {
  reverse_proxy opencode:3000
  tls ${config.email || 'internal'}
}

gateway.${config.domain} {
  reverse_proxy openclaw:18789
  tls ${config.email || 'internal'}
}

www.${config.domain} {
  reverse_proxy website:3000
  tls ${config.email || 'internal'}
}
`;

  await fs.writeFile(
    path.join(config.deployDir, 'Caddyfile'),
    caddyfile
  );
}

async function configureCoolify(config: DomainConfig): Promise<void> {
  // Coolify uses its own configuration
  // This would integrate with Coolify API
  logger.info('Coolify configuration would require API integration');
  logger.info('For now, use Coolify dashboard to add resources');
}

export async function validateDomain(domain: string): Promise<{
  valid: boolean;
  message: string;
  suggestions?: string[];
}> {
  // Check format
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
  
  if (!domainRegex.test(domain)) {
    return {
      valid: false,
      message: 'Invalid domain format',
      suggestions: [
        'Use format: example.com',
        'No subdomains for root domain',
        'Valid characters: a-z, 0-9, hyphen'
      ]
    };
  }

  // Check if domain is available (optional)
  // This could use a WHOIS API

  return {
    valid: true,
    message: 'Domain format is valid'
  };
}

export async function getSSLStatus(domain: string): Promise<{
  active: boolean;
  expiry?: Date;
  issuer?: string;
}> {
  try {
    const { stdout } = await execAsync(
      `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -dates -issuer`
    );
    
    const notAfter = stdout.match(/notAfter=(.+)/)?.[1];
    const issuer = stdout.match(/issuer=.+O=(.+?)(?:,|$)/)?.[1];
    
    if (notAfter) {
      return {
        active: true,
        expiry: new Date(notAfter),
        issuer: issuer || 'Unknown'
      };
    }
    
    return { active: false };
  } catch {
    return { active: false };
  }
}
