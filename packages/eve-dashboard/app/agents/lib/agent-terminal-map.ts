/**
 * Single source of truth for which terminal kinds each agent supports.
 * Mirrored on the sidecar in `server/terminal-sidecar.ts`. Keep them in sync.
 *
 * Also carries the display metadata (label/description) for the client UI.
 * Mirrored from `@eve/dna`'s AGENT_REGISTRY — duplicating it keeps the client
 * bundle free of node-only deps (`fs`, `child_process`) that the DNA package
 * pulls in via secrets I/O.
 */

export type TerminalKind = "repl" | "logs" | "recipe";

interface AgentDisplay {
  label: string;
  description: string;
  kinds: ReadonlyArray<TerminalKind>;
}

const AGENTS: Record<string, AgentDisplay> = {
  eve: {
    label: "Eve",
    description: "The orchestrator CLI itself. Spawns an interactive shell with `eve` on PATH.",
    kinds: ["repl", "recipe"],
  },
  openclaw: {
    label: "OpenClaw",
    description: "Action / messaging agent. Open a REPL on the host or run recipes via docker exec.",
    kinds: ["repl", "recipe"],
  },
  coder: {
    label: "Coder",
    description: "Local AI coder — claudecode / opencode / openclaude based on secrets.builder.codeEngine.",
    kinds: ["repl", "recipe"],
  },
  hermes: {
    label: "Hermes",
    description: "Multi-personality task daemon. Read its log stream or run recipes.",
    kinds: ["logs", "recipe"],
  },
  "openwebui-pipelines": {
    label: "OpenWebUI Pipelines",
    description: "Pipeline sidecar for OpenWebUI. Read its log stream or run recipes.",
    kinds: ["logs", "recipe"],
  },
};

export function agentTerminalKinds(slug: string): ReadonlyArray<TerminalKind> {
  return AGENTS[slug]?.kinds ?? [];
}

export function agentDisplay(slug: string): { label: string; description: string } | null {
  const a = AGENTS[slug];
  return a ? { label: a.label, description: a.description } : null;
}

/**
 * Build the WebSocket URL for a given kind. The sidecar address comes from
 * the `EVE_TERMINAL_SIDECAR_URL` env baked at build time, with a sensible
 * dev default. We swap the http(s) scheme to ws(s).
 */
export function terminalSidecarWsUrl(
  kind: TerminalKind,
  params: Record<string, string | undefined> = {},
): string {
  const base =
    process.env.NEXT_PUBLIC_EVE_TERMINAL_SIDECAR_URL ??
    (typeof window !== "undefined"
      ? `ws://${window.location.hostname}:3041`
      : "ws://localhost:3041");
  const wsBase = base
    .replace(/^https:\/\//, "wss://")
    .replace(/^http:\/\//, "ws://")
    .replace(/\/+$/, "");
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join("&");
  return `${wsBase}/${kind}${qs ? `?${qs}` : ""}`;
}
