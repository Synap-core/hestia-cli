/**
 * Synap pod metadata for the drawer's config panel.
 *
 * Read-only — surfaces what's recorded about the pod (URL, hub URL, admin
 * bootstrap mode, admin email) plus a list of Synap-related Docker volumes
 * the operator might back up.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { readEveSecrets, entityStateManager, readSetupProfile, resolveSynapUrl } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

const execFileAsync = promisify(execFile);

interface VolumeRow {
  name: string;
  driver: string;
  size: string | null;
}

async function listSynapVolumes(): Promise<VolumeRow[]> {
  try {
    // {{.Name}} {{.Driver}} — `docker volume ls` doesn't expose size; we
    // fetch sizes separately via `docker system df -v` if available.
    const { stdout } = await execFileAsync(
      "docker",
      ["volume", "ls", "--format", "{{.Name}}\t{{.Driver}}"],
      { encoding: "utf-8" },
    );
    const matches = stdout
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .filter(l => /synap|openwebui|ollama|eve/.test(l));

    return matches.map(line => {
      const [name, driver] = line.split("\t");
      return { name: name ?? "", driver: driver ?? "local", size: null };
    });
  } catch {
    return [];
  }
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const state = await entityStateManager.getState();
  // The admin bootstrap fields live in the v1 setup-profile.json (separate
  // file from the entity state, which carries v2 setupProfile metadata).
  const setupProfile = await readSetupProfile(process.env.EVE_HOME || process.cwd());
  const installedEntry = state?.installed?.synap as
    | { state?: string; version?: string }
    | undefined;

  const volumes = await listSynapVolumes();

  return NextResponse.json({
    podUrl: resolveSynapUrl(secrets),
    hubBaseUrl: secrets?.synap?.hubBaseUrl ?? null,
    apiKeyPresent: Boolean(secrets?.synap?.apiKey),
    domain: secrets?.domain?.primary ?? null,
    ssl: Boolean(secrets?.domain?.ssl),
    adminEmail: setupProfile?.synapInstall?.adminEmail ?? null,
    adminBootstrapMode: setupProfile?.synapInstall?.adminBootstrapMode ?? null,
    state: installedEntry?.state ?? null,
    version: installedEntry?.version ?? null,
    volumes,
  });
}
