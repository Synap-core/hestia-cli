/**
 * Docker Compose Generator
 * Generates unified docker-compose.yml for complete Hestia deployment
 */

import * as YAML from 'js-yaml';

interface GenerateOptions {
  domain: string;
  profile: 'minimal' | 'full' | 'ai-heavy';
  provider: 'opencode' | 'openclaude' | 'both' | 'none';
  website?: boolean;
}

export async function generateDockerCompose(options: GenerateOptions): Promise<string> {
  const compose: any = {
    version: '3.8',
    services: {},
    networks: { 'hestia-net': { driver: 'bridge' } },
    volumes: {}
  };

  // Core services (always included)
  compose.services = {
    ...generateSynapBackend(options),
    ...generateDatabase(),
    ...generateRedis(),
    ...generateMinio(),
    ...generateTypesense(),
    ...generateTraefik(options)
  };

  // AI services based on provider
  if (options.provider === 'opencode' || options.provider === 'both') {
    compose.services = {
      ...compose.services,
      ...generateOpenCode(options)
    };
  }

  if (options.provider === 'openclaude' || options.provider === 'both') {
    compose.services = {
      ...compose.services,
      ...generateOpenClaw(options)
    };
  }

  // Website if requested
  if (options.website) {
    compose.services = {
      ...compose.services,
      ...generateWebsite(options)
    };
  }

  // Volumes
  compose.volumes = {
    postgres_data: {},
    redis_data: {},
    minio_data: {},
    typesense_data: {},
    traefik_certs: {},
    opencode_workspace: {},
    openclaw_data: {}
  };

  return YAML.dump(compose, { indent: 2 });
}

function generateSynapBackend(options: GenerateOptions) {
  return {
    'synap-backend': {
      image: 'ghcr.io/synap-core/backend:latest',
      restart: 'always',
      environment: {
        NODE_ENV: 'production',
        PORT: 4000,
        DATABASE_URL: 'postgresql://synap:${POSTGRES_PASSWORD}@postgres:5432/synap',
        REDIS_URL: 'redis://redis:6379',
        MINIO_ENDPOINT: 'http://minio:9000',
        TYPESENSE_HOST: 'typesense',
        PUBLIC_URL: `https://${options.domain}`,
        FRONTEND_URL: `https://${options.domain}`,
        JWT_SECRET: '${JWT_SECRET}',
        HUB_PROTOCOL_API_KEY: '${HUB_PROTOCOL_API_KEY}'
      },
      depends_on: ['postgres', 'redis', 'minio', 'typesense'],
      networks: ['hestia-net'],
      labels: [
        'traefik.enable=true',
        `traefik.http.routers.synap.rule=Host(\`${options.domain}\`)`,
        'traefik.http.routers.synap.entrypoints=websecure',
        'traefik.http.routers.synap.tls.certresolver=letsencrypt',
        'traefik.http.services.synap.loadbalancer.server.port=4000'
      ],
      healthcheck: {
        test: ['CMD', 'node', '-e', 'require("http").get("http://localhost:4000/health", r => process.exit(r.statusCode === 200 ? 0 : 1))'],
        interval: '30s',
        timeout: '10s',
        retries: 3
      }
    }
  };
}

function generateDatabase() {
  return {
    postgres: {
      image: 'timescale/timescaledb-ha:pg15',
      restart: 'always',
      environment: {
        POSTGRES_USER: 'synap',
        POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}',
        POSTGRES_DB: 'synap'
      },
      volumes: ['postgres_data:/var/lib/postgresql/data'],
      networks: ['hestia-net'],
      healthcheck: {
        test: ['CMD-SHELL', 'pg_isready -U synap'],
        interval: '10s',
        timeout: '5s',
        retries: 5
      }
    }
  };
}

function generateRedis() {
  return {
    redis: {
      image: 'redis:7-alpine',
      restart: 'always',
      command: 'redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru',
      volumes: ['redis_data:/data'],
      networks: ['hestia-net']
    }
  };
}

function generateMinio() {
  return {
    minio: {
      image: 'minio/minio:latest',
      restart: 'always',
      command: 'server /data --console-address ":9001"',
      environment: {
        MINIO_ROOT_USER: '${MINIO_ACCESS_KEY}',
        MINIO_ROOT_PASSWORD: '${MINIO_SECRET_KEY}'
      },
      volumes: ['minio_data:/data'],
      networks: ['hestia-net'],
      ports: ['9000:9000', '9001:9001']
    }
  };
}

function generateTypesense() {
  return {
    typesense: {
      image: 'typesense/typesense:0.25.2',
      restart: 'always',
      command: '--data-dir /data --api-key=${TYPESENSE_API_KEY} --enable-cors',
      volumes: ['typesense_data:/data'],
      networks: ['hestia-net'],
      ports: ['8108:8108']
    }
  };
}

function generateTraefik(options: GenerateOptions) {
  return {
    traefik: {
      image: 'traefik:v3.0',
      restart: 'always',
      command: [
        '--api.dashboard=true',
        '--providers.docker=true',
        '--providers.docker.exposedbydefault=false',
        '--entrypoints.web.address=:80',
        '--entrypoints.websecure.address=:443',
        '--certificatesresolvers.letsencrypt.acme.tlschallenge=true',
        '--certificatesresolvers.letsencrypt.acme.email=${LETSENCRYPT_EMAIL}',
        '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json',
        '--accesslog=true',
        '--log.level=INFO'
      ],
      ports: ['80:80', '443:443'],
      volumes: [
        '/var/run/docker.sock:/var/run/docker.sock:ro',
        'traefik_certs:/letsencrypt'
      ],
      networks: ['hestia-net'],
      labels: [
        'traefik.enable=true',
        `traefik.http.routers.traefik.rule=Host(\`traefik.${options.domain}\`)`,
        'traefik.http.routers.traefik.service=api@internal',
        'traefik.http.routers.traefik.tls.certresolver=letsencrypt'
      ]
    }
  };
}

function generateOpenCode(options: GenerateOptions) {
  return {
    opencode: {
      image: 'ghcr.io/opencode/opencode:latest',
      restart: 'unless-stopped',
      environment: {
        SYNAP_POD_URL: `http://synap-backend:4000`,
        SYNAP_HUB_API_KEY: '${HUB_PROTOCOL_API_KEY}',
        SYNAP_WORKSPACE_ID: 'default',
        OPENCODE_DOMAIN: `dev.${options.domain}`,
        OPENCODE_MODEL: '${OPENCODE_MODEL:-anthropic/claude-sonnet-4-6}'
      },
      volumes: [
        'opencode_workspace:/workspace',
        '/var/run/docker.sock:/var/run/docker.sock'
      ],
      networks: ['hestia-net'],
      labels: [
        'traefik.enable=true',
        `traefik.http.routers.opencode.rule=Host(\`dev.${options.domain}\`)`,
        'traefik.http.routers.opencode.entrypoints=websecure',
        'traefik.http.routers.opencode.tls.certresolver=letsencrypt',
        'traefik.http.services.opencode.loadbalancer.server.port=3000'
      ],
      profiles: ['opencode']
    }
  };
}

function generateOpenClaw(options: GenerateOptions) {
  return {
    openclaw: {
      image: 'ghcr.io/openclaw/openclaw:latest',
      restart: 'unless-stopped',
      environment: {
        SYNAP_POD_URL: `http://synap-backend:4000`,
        SYNAP_HUB_API_KEY: '${OPENCLAW_HUB_API_KEY}',
        SYNAP_WORKSPACE_ID: 'default',
        OPENCLAW_MODEL: '${OPENCLAW_MODEL:-anthropic/claude-sonnet-4-6}'
      },
      volumes: ['openclaw_data:/root/.openclaw'],
      networks: ['hestia-net'],
      ports: ['18789:18789'],
      labels: [
        'traefik.enable=true',
        `traefik.http.routers.openclaw.rule=Host(\`gateway.${options.domain}\`) && PathPrefix(\`/gateway\`)`,
        'traefik.http.routers.openclaw.entrypoints=websecure',
        'traefik.http.routers.openclaw.tls.certresolver=letsencrypt'
      ],
      profiles: ['openclaw']
    }
  };
}

function generateWebsite(options: GenerateOptions) {
  return {
    website: {
      build: {
        context: './website',
        dockerfile: 'Dockerfile'
      },
      restart: 'always',
      environment: {
        NEXT_PUBLIC_SYNAP_URL: `https://${options.domain}`,
        NEXT_PUBLIC_TYPESENSE_URL: `https://${options.domain}:8108`
      },
      networks: ['hestia-net'],
      labels: [
        'traefik.enable=true',
        `traefik.http.routers.website.rule=Host(\`www.${options.domain}\`)`,
        'traefik.http.routers.website.entrypoints=websecure',
        'traefik.http.routers.website.tls.certresolver=letsencrypt',
        'traefik.http.services.website.loadbalancer.server.port=3000'
      ],
      profiles: ['website']
    }
  };
}
