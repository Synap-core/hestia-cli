import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import {
  COMPONENTS,
  type ComponentInfo,
  entityStateManager,
  readEveSecrets,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

export interface ComponentRow {
  id: string;
  label: string;
  emoji: string;
  description: string;
  category: ComponentInfo["category"];
  organ: string | null;
  /** True if recorded in setup-profile.json. */
  installed: boolean;
  /** Live container check via `docker ps` (null if no container expected). */
  containerRunning: boolean | null;
  containerName: string | null;
  internalPort: number | null;
  hostPort: number | null;
  subdomain: string | null;
  domainUrl: string | null;
  state: string | null;
  version: string | null;
  /** Components that *require* this one (reverse dependency). */
  requiredBy: string[];
  requires: string[];
  alwaysInstall: boolean;
}

function isContainerRunning(name: string): boolean {
  try {
    const out = execSync(
      `docker ps --filter "name=^${name}$" --format "{{.Names}}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] },
    ).trim();
    return out === name;
  } catch {
    return false;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const domain = secrets?.domain?.primary;
  const ssl = secrets?.domain?.ssl !== false;
  const protocol = ssl ? "https" : "http";

  // What does state.json know? Each entry has its recorded state + version.
  let installedSet = new Set<string>();
  let installedMap: Record<string, { state: string; version?: string }> = {};
  try {
    const state = await entityStateManager.getState();
    installedSet = new Set(await entityStateManager.getInstalledComponents());
    installedMap = (state?.installed ?? {}) as typeof installedMap;
  } catch {
    // No state yet — fine. installed remains empty.
  }

  // Compute reverse deps once.
  const requiredByMap = new Map<string, string[]>();
  for (const c of COMPONENTS) {
    for (const req of c.requires ?? []) {
      const list = requiredByMap.get(req) ?? [];
      list.push(c.id);
      requiredByMap.set(req, list);
    }
  }

  const rows: ComponentRow[] = COMPONENTS.map((c) => {
    const containerName = c.service?.containerName ?? null;
    const installed = installedSet.has(c.id);
    const entry = installedMap[c.id];

    // Only check live container state for installed components — skip the
    // `docker ps` shell call for everything we know isn't running.
    const containerRunning = installed && containerName
      ? isContainerRunning(containerName)
      : containerName
        ? null
        : null;

    return {
      id: c.id,
      label: c.label,
      emoji: c.emoji,
      description: c.description,
      category: c.category,
      organ: c.organ ?? null,
      installed,
      containerRunning,
      containerName,
      internalPort: c.service?.internalPort ?? null,
      hostPort: c.service?.hostPort ?? null,
      subdomain: c.service?.subdomain ?? null,
      domainUrl:
        domain && c.service?.subdomain
          ? `${protocol}://${c.service.subdomain}.${domain}`
          : null,
      state: entry?.state ?? null,
      version: entry?.version ?? null,
      requiredBy: requiredByMap.get(c.id) ?? [],
      requires: c.requires ?? [],
      alwaysInstall: !!c.alwaysInstall,
    };
  });

  return NextResponse.json({ components: rows });
}
