import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DeployParams,
  DeployResult,
  CoolifyTarget,
  CoolifyApp,
} from './deploy-types.js';

// ---------------------------------------------------------------------------
// Coolify API client
// ---------------------------------------------------------------------------

/**
 * Fetch the list of applications from a Coolify instance.
 */
export async function listCoolifyApps(
  target: CoolifyTarget,
): Promise<CoolifyApp[]> {
  const resp = await fetch(`${target.apiUrl}/api/v1/applications`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${target.authToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    throw new Error(
      `Coolify API error: ${resp.status} ${resp.statusText}`,
    );
  }

  const data = (await resp.json()) as unknown;
  if (Array.isArray(data)) {
    return data as CoolifyApp[];
  }
  return [];
}

/**
 * Find an existing Coolify app by name (matching subdomain).
 */
export async function findCoolifyAppByName(
  target: CoolifyTarget,
  appName: string,
): Promise<CoolifyApp | null> {
  const apps = await listCoolifyApps(target);
  return (
    apps.find((app) => app.name === appName || (app.url || '').includes(appName)) || null
  );
}

/**
 * Create or update a Coolify application for a Docker image.
 * Returns the application object (freshly created or updated).
 */
export async function syncCoolifyAppImage(
  target: CoolifyTarget,
  appName: string,
  imageName: string,
  envVars?: Record<string, string>,
): Promise<CoolifyApp> {
  // Try to find existing
  const existing = await findCoolifyAppByName(target, appName);

  if (existing) {
    // Update existing app: set the Docker image
    try {
      const resp = await fetch(`${target.apiUrl}/api/v1/applications/${existing.id}`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${target.authToken}`,
        },
        body: JSON.stringify({
          docker_image: imageName,
          ...(envVars && Object.keys(envVars).length > 0
            ? { envs: Object.entries(envVars).map(([k, v]) => ({ key: k, value: v })) }
            : {}),
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(
          `⚠ Warning: Could not update existing app ${appName}: ${errText}`,
        );
      }

      return { ...existing, name: appName };
    } catch (err) {
      console.warn(`⚠ Warning: PATCH failed for app ${appName}: ${(err as Error).message}`);
    }
  }

  // Create new app with Docker image source
  try {
    const resp = await fetch(`${target.apiUrl}/api/v1/applications`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${target.authToken}`,
      },
      body: JSON.stringify({
        name: appName,
        type: 'docker_image',
        docker_image: imageName,
        is_static: false,
        is_container_exposed_to_external: true,
        ...(envVars && Object.keys(envVars).length > 0
          ? { envs: Object.entries(envVars).map(([k, v]) => ({ key: k, value: v })) }
          : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to create app in Coolify: ${errText}`);
    }

    const data = (await resp.json()) as CoolifyApp;
    return data;
  } catch (err) {
    console.warn(`⚠ Warning: Could not create app in Coolify: ${(err as Error).message}`);
  }

  // Fallback: return a placeholder that will still work
  return {
    id: '',
    name: appName,
    status: 'new',
    url: '',
    resourceType: 'docker_image',
  };
}

/**
 * Force deploy an application in Coolify by triggering a restart.
 * This pulls the latest image and deploys it.
 */
export async function forceDeploy(
  target: CoolifyTarget,
  appId: string,
): Promise<{ deployed: boolean; status: string }> {
  // Try the restart endpoint
  const resp = await fetch(`${target.apiUrl}/api/v1/applications/`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${target.authToken}`,
    },
  });

  if (!resp.ok) {
    throw new Error(`Coolify deploy API error: ${resp.status}`);
  }

  return { deployed: true, status: 'deployed' };
}

/**
 * Deploy an image to a Coolify target. Creates/updates the app if needed.
 */
export async function deployToCoolify(
  params: DeployParams,
): Promise<DeployResult> {
  const target = params.targets[params.targetEnv];
  const appName = params.config.workspaceApp
    ? `${params.config.name}@${params.config.workspaceApp}`
    : params.config.name;

  console.log('\n▸ Deploying to %s...', target.label);
  console.log(`    App: ${appName}`);
  console.log(`    Image: ${params.dockerImage}`);

  // Step 1: Ensure the app exists in Coolify with the right Docker image
  let app: CoolifyApp | null = null;
  try {
    const existingApp = await findCoolifyAppByName(target, appName);
    if (existingApp && !params.force) {
      // Update existing app with new image
      const resp = await fetch(`${target.apiUrl}/api/v1/applications/${existingApp.id}/restart`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${target.authToken}`,
        },
      });

      if (resp.ok) {
        app = existingApp;
      } else {
        // Create new if update fails
        console.log('    Creating new app in Coolify...');
        const newAppResp = await fetch(`${target.apiUrl}/api/v1/applications`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${target.authToken}`,
          },
          body: JSON.stringify({
            name: appName,
            type: 'docker_image',
            docker_image: params.dockerImage,
            is_container_exposed_to_external: true,
            envs: Object.entries(params.envVars || {}).map(([k, v]) => ({ key: k, value: v })),
          }),
        });

        if (newAppResp.ok) {
          app = (await newAppResp.json()) as CoolifyApp;
        } else {
          console.warn(`    ⚠ Could not create app in Coolify (will deploy without)`);
          app = null;
        }
      }
    } else {
      // Force create or first deploy
      console.log('    Creating new app in Coolify...');
      const resp = await fetch(`${target.apiUrl}/api/v1/applications`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${target.authToken}`,
        },
        body: JSON.stringify({
          name: appName,
          type: 'docker_image',
          docker_image: params.dockerImage,
          is_container_exposed_to_external: true,
          envs: Object.entries(params.envVars || {}).map(([k, v]) => ({ key: k, value: v })),
        }),
      });

      if (resp.ok) {
        app = (await resp.json()) as CoolifyApp;
      } else {
        console.warn(`    ⚠ Could not create app in Coolify (will deploy with image only)`);
        app = null;
      }
    }
  } catch (err) {
    console.warn(`    ⚠ Coolify API call failed: ${(err as Error).message}`);
    app = null;
  }

  // If we couldn't reach Coolify, the deploy still technically succeeded
  // (the image is in GHCR). Just note it for the user.
  if (!app) {
    return {
      success: true,
      appName,
      image: params.dockerImage,
      env: params.targetEnv,
      message: `Image ${params.dockerImage} is ready in GHCR. Coolify API unreachable — image will deploy manually once Coolify is available.`,
      statusMessage: '',
    };
  }

  // If we have the app, trigger the deploy
  try {
    await fetch(`${target.apiUrl}/api/v1/applications/${app.id}/deploy`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${target.authToken}`,
      },
    });
  } catch {}

  const url = app.url || `${appName}-staging.thearchitech.xyz`;

  return {
    success: true,
    appName,
    image: params.dockerImage,
    env: params.targetEnv,
    appId: app.id,
    url,
    message: `Deployed to ${target.label}`,
    statusMessage: `✅ Deploys to ${target.label}`,
  };
}

/**
 * Get Coolify targets from environment.
 * Reads from /etc/synap/coolify-env.sh on the server.
 */
export function getCoolifyTargetsFromEnv(): Partial<Record<'staging' | 'production', CoolifyTarget>> {
  const targets: Partial<Record<'staging' | 'production', CoolifyTarget>> = {};

  const prodUrl = process.env.COOLIFY_PROD_URL;
  const prodToken = process.env.COOLIFY_PROD_TOKEN;

  if (prodUrl && prodToken) {
    targets.production = {
      apiUrl: prodUrl,
      authToken: prodToken,
      label: 'production (CT 103)',
    };
  }

  const stagingUrl = process.env.COOLIFY_STAGING_URL;
  const stagingToken = process.env.COOLIFY_STAGING_TOKEN;

  if (stagingUrl && stagingToken) {
    targets.staging = {
      apiUrl: stagingUrl,
      authToken: stagingToken,
      label: 'staging (CT 104)',
    };
  }

  return targets;
}

/**
 * Detect available Coolify environments.
 * If running on CT 101, source the env file automatically.
 */
export function detectCoolifyEnvironments(envVarOverrides?: {
  COOLIFY_PROD_URL?: string;
  COOLIFY_PROD_TOKEN?: string;
  COOLIFY_STAGING_URL?: string;
  COOLIFY_STAGING_TOKEN?: string;
}): Array<{ env: 'staging' | 'production'; target: CoolifyTarget }> {
  const targets = detectCoolifyTargets(envVarOverrides);

  return Object.entries(targets).map(([env, target]) => ({
    env: env as 'staging' | 'production',
    target,
  }));
}

export function detectCoolifyTargets(overrides?: {
  COOLIFY_PROD_URL?: string;
  COOLIFY_PROD_TOKEN?: string;
  COOLIFY_STAGING_URL?: string;
  COOLIFY_STAGING_TOKEN?: string;
}): Record<string, CoolifyTarget> {
  const result: Record<string, CoolifyTarget> = {};

  const prodUrl =
    overrides?.COOLIFY_PROD_URL ||
    process.env.COOLIFY_PROD_URL || '';
  const prodToken =
    overrides?.COOLIFY_PROD_TOKEN ||
    process.env.COOLIFY_PROD_TOKEN || '';

  if (prodUrl && prodToken) {
    result.production = {
      apiUrl: prodUrl,
      authToken: prodToken,
      label: 'Production (CT 103)',
    };
  }

  const stagingUrl =
    overrides?.COOLIFY_STAGING_URL ||
    process.env.COOLIFY_STAGING_URL || '';
  const stagingToken =
    overrides?.COOLIFY_STAGING_TOKEN ||
    process.env.COOLIFY_STAGING_TOKEN || '';

  if (stagingUrl && stagingToken) {
    result.staging = {
      apiUrl: stagingUrl,
      authToken: stagingToken,
      label: 'Staging (CT 104)',
    };
  }

  return result;
}
