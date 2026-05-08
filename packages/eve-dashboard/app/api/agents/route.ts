import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AGENTS,
  COMPONENTS,
  entityStateManager,
  readEveSecrets,
  resolvePodUrl,
} from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

const execFileAsync = promisify(execFile);

interface AgentRow {
  agentType: string;
  label: string;
  description: string;
  status: "ready" | "missing" | "running" | "stopped" | "unknown";
  hasKey: boolean;
  componentInstalled: boolean;
  containerName: string | null;
  containerRunning: boolean | null;
  /** Last 8 chars of the keyId for dashboard display. */
  keyIdPrefix?: string;
  /** ISO-8601 timestamp when the key was last minted. */
  keyCreatedAt?: string;
  /** External pod URL for the consumer to connect to. */
  podUrl?: string;
}

async function isContainerRunning(name: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "--filter", `name=^${name}$`, "--format", "{{.Names}}"],
      { encoding: "utf-8" },
    );
    return stdout.trim() === name;
  } catch {
    return false;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets();
  const podUrl = await resolvePodUrl();

  const installedSet = new Set<string>();
  try {
    const ids = await entityStateManager.getInstalledComponents();
    for (const id of ids) installedSet.add(id);
  } catch {
    /* state may not exist yet on a fresh install */
  }

  const componentById = new Map(COMPONENTS.map((c) => [c.id, c]));

  const rows: AgentRow[] = await Promise.all(
    AGENTS.map(async (agent) => {
      const hasKey = !!secrets?.agents?.[agent.agentType]?.hubApiKey;
      const componentId = agent.componentId;
      const component = componentId ? componentById.get(componentId) : null;
      const containerName = component?.service?.containerName ?? null;
      const componentInstalled = componentId ? installedSet.has(componentId) : true;

      let status: AgentRow["status"] = "unknown";
      let containerRunning: boolean | null = null;

      if (componentId) {
        if (!componentInstalled) {
          status = "missing";
        } else if (containerName) {
          containerRunning = await isContainerRunning(containerName);
          status = containerRunning ? "running" : "stopped";
        } else {
          // installed but has no container (e.g. CLI helper)
          status = "ready";
        }
      } else {
        // No componentId — these are local/CLI agents (eve, coder).
        // They are "ready" as soon as the key exists; otherwise unknown.
        status = hasKey ? "ready" : "unknown";
      }

      // Extract key metadata from secrets
      const agentEntry = secrets?.agents?.[agent.agentType];
      const hasKeyMetadata = !!agentEntry;
      const keyIdPrefix = hasKeyMetadata && agentEntry.keyId
        ? agentEntry.keyId.slice(-8)
        : undefined;
      const keyCreatedAt = hasKeyMetadata ? agentEntry.createdAt : undefined;

      return {
        agentType: agent.agentType,
        label: agent.label,
        description: agent.description,
        status,
        hasKey,
        componentInstalled,
        containerName,
        containerRunning,
        ...(keyIdPrefix ? { keyIdPrefix } : {}),
        ...(keyCreatedAt ? { keyCreatedAt } : {}),
        ...(podUrl ? { podUrl } : {}),
      };
    }),
  );

  return NextResponse.json({ agents: rows });
}
