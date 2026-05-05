/**
 * Kratos config generation for Eve self-hosted deployments.
 *
 * Writes config/kratos/kratos.yml + identity.schema.json and returns the
 * env vars that must be added to .env so docker-compose variable substitution
 * picks them up.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export interface KratosSecrets {
  KRATOS_SECRETS_COOKIE: string;
  KRATOS_SECRETS_CIPHER: string;
  KRATOS_WEBHOOK_SECRET: string;
  KRATOS_DSN: string;
  KRATOS_CONFIG_DIR: string;
}

function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

const IDENTITY_SCHEMA = JSON.stringify(
  {
    $id: 'https://schemas.ory.sh/presets/kratos/quickstart/email-password/identity.schema.json',
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Person',
    type: 'object',
    properties: {
      traits: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            title: 'E-Mail',
            minLength: 3,
            'ory.sh/kratos': {
              credentials: { password: { identifier: true } },
              verification: { via: 'email' },
              recovery: { via: 'email' },
            },
          },
          name: { type: 'string', title: 'Name' },
        },
        required: ['email'],
        additionalProperties: false,
      },
    },
  },
  null,
  2,
);

function buildKratosYml(domain: string, postgresPassword: string, webhookSecret: string, backendUrl = 'http://eve-brain-synap:4000'): string {
  return `version: v1.3.1

dsn: postgres://synap:${postgresPassword}@eve-brain-postgres:5432/kratos?sslmode=disable

log:
  level: info
  format: text

serve:
  public:
    base_url: https://${domain}/.ory/kratos/public/
    cors:
      enabled: true
      allowed_origins:
        - https://${domain}
      allowed_headers:
        - Authorization
        - Content-Type
        - Cookie
        - X-Session-Token
      exposed_headers:
        - Content-Type
        - Set-Cookie
      allow_credentials: true
  admin:
    base_url: http://eve-brain-kratos:4434

selfservice:
  default_browser_return_url: https://${domain}/admin/
  allowed_return_urls:
    - https://${domain}
    - https://${domain}/*

  methods:
    password:
      enabled: true
    oidc:
      enabled: false

  flows:
    login:
      ui_url: https://${domain}/admin/kratos
      lifespan: 10m
    registration:
      ui_url: https://${domain}/admin/kratos
      lifespan: 10m
    recovery:
      enabled: true
      ui_url: https://${domain}/admin/kratos
    settings:
      ui_url: https://${domain}/admin/kratos
      privileged_session_max_age: 15m
      after:
        password:
          hooks:
            - hook: web_hook
              config:
                url: ${backendUrl}/webhooks/kratos
                method: POST
                body: base64://eyJmbG93X2lkIjoie3sgLkZsb3cuSUQgfX0iLCAiaWRlbnRpdHkiOiB7eyAuSWRlbnRpdHkgfCB0b0pzb24gfX19
    verification:
      enabled: false
    logout:
      after:
        default_browser_return_url: https://${domain}/admin/

session:
  cookie:
    domain: ${domain}
    same_site: Lax

identity:
  default_schema_id: default
  schemas:
    - id: default
      url: file:///etc/config/kratos/identity.schema.json

courier:
  smtp:
    from_address: noreply@${domain}
    from_name: Synap
`;
}

/**
 * Write Kratos config files into deployDir/config/kratos/.
 * Generates secrets if they don't already exist (idempotent on repeated runs).
 *
 * @param deployDir  Root deploy directory (e.g. /opt/synap-backend)
 * @param domain     Public domain (e.g. hyperray.shop — without pod. prefix)
 * @param postgresPassword  Value of POSTGRES_PASSWORD from .env
 * @param existing   Previously-generated secrets to reuse (avoids rotation)
 */
export async function generateKratosConfig(
  deployDir: string,
  domain: string,
  postgresPassword: string,
  existing?: Partial<KratosSecrets>,
): Promise<KratosSecrets> {
  const configDir = join(deployDir, 'config', 'kratos');
  await mkdir(configDir, { recursive: true });

  const cookie = existing?.KRATOS_SECRETS_COOKIE || randomHex(32);
  const cipher = existing?.KRATOS_SECRETS_CIPHER || randomHex(32);
  const webhook = existing?.KRATOS_WEBHOOK_SECRET || randomHex(24);

  const yml = buildKratosYml(domain, postgresPassword, webhook);

  // Append secrets block (kratos reads env vars SECRETS_COOKIE / SECRETS_CIPHER,
  // so the yml doesn't need them inline — but we write them for completeness
  // and for the migrate.sh fallback path).
  const fullYml = yml + `
secrets:
  cookie:
    - ${cookie}
  cipher:
    - ${cipher}
`;

  await writeFile(join(configDir, 'kratos.yml'), fullYml, 'utf-8');
  await writeFile(join(configDir, 'identity.schema.json'), IDENTITY_SCHEMA, 'utf-8');

  return {
    KRATOS_SECRETS_COOKIE: cookie,
    KRATOS_SECRETS_CIPHER: cipher,
    KRATOS_WEBHOOK_SECRET: webhook,
    KRATOS_DSN: `postgres://synap:${postgresPassword}@eve-brain-postgres:5432/kratos?sslmode=disable`,
    KRATOS_CONFIG_DIR: configDir,
  };
}

/**
 * Read existing Kratos secrets from a .env file fragment (key=value lines).
 * Returns only the keys relevant to Kratos so callers can pass them to
 * generateKratosConfig as `existing` to avoid unnecessary rotation.
 */
export function parseKratosSecretsFromEnv(envContent: string): Partial<KratosSecrets> {
  const result: Partial<KratosSecrets> = {};
  for (const line of envContent.split('\n')) {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=').trim();
    if (!key || !value) continue;
    if (key === 'KRATOS_SECRETS_COOKIE') result.KRATOS_SECRETS_COOKIE = value;
    if (key === 'KRATOS_SECRETS_CIPHER') result.KRATOS_SECRETS_CIPHER = value;
    if (key === 'KRATOS_WEBHOOK_SECRET') result.KRATOS_WEBHOOK_SECRET = value;
    if (key === 'KRATOS_DSN') result.KRATOS_DSN = value;
    if (key === 'KRATOS_CONFIG_DIR') result.KRATOS_CONFIG_DIR = value;
  }
  return result;
}
