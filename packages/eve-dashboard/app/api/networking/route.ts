/**
 * Networking summary — domain config, raw Traefik dynamic config, tunnel state.
 *
 * Subdomain map is served separately by /api/access (already enriched with
 * DNS resolution); this endpoint adds the deeper "how is the routing
 * configured" layer.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { readEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

const TRAEFIK_DYNAMIC_DIR = "/opt/traefik/dynamic";
const TRAEFIK_DYNAMIC_FILE = `${TRAEFIK_DYNAMIC_DIR}/eve-routes.yml`;
const TRAEFIK_STATIC_FILE = "/opt/traefik/traefik.yml";

interface TraefikInfo {
  dynamicConfigPath: string;
  dynamicConfig: string | null;
  staticConfigPath: string;
  staticConfig: string | null;
  containerRunning: boolean;
}

function isTraefikRunning(): boolean {
  try {
    const out = execSync(
      'docker ps --filter "name=^eve-legs-traefik$" --format "{{.Names}}"',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] },
    ).trim();
    return out === "eve-legs-traefik";
  } catch {
    return false;
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    if (!existsSync(path)) return null;
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();

  const traefik: TraefikInfo = {
    dynamicConfigPath: TRAEFIK_DYNAMIC_FILE,
    dynamicConfig:    await readIfExists(TRAEFIK_DYNAMIC_FILE),
    staticConfigPath: TRAEFIK_STATIC_FILE,
    staticConfig:     await readIfExists(TRAEFIK_STATIC_FILE),
    containerRunning: isTraefikRunning(),
  };

  return NextResponse.json({
    domain: secrets?.domain ?? null,
    traefik,
  });
}
