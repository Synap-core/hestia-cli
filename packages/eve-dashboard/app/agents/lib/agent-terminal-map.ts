/**
 * Single source of truth for which terminal kinds each agent supports.
 * Mirrored on the sidecar in `server/terminal-sidecar.ts`. Keep them in sync.
 */

export type TerminalKind = "repl" | "logs" | "recipe";

const MAP: Record<string, ReadonlyArray<TerminalKind>> = {
  eve: ["repl", "recipe"],
  openclaw: ["repl", "recipe"],
  coder: ["repl", "recipe"],
  hermes: ["logs", "recipe"],
  "openwebui-pipelines": ["logs", "recipe"],
};

export function agentTerminalKinds(slug: string): ReadonlyArray<TerminalKind> {
  return MAP[slug] ?? [];
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
