/**
 * Coder router — maps a `secrets.builder.codeEngine` choice to the actual
 * CLI binary + args that should be spawned.
 *
 * The Hub Protocol identity is always the single `coder` agent slug. This
 * router is purely about which local subprocess executes the task. The
 * three adapters in this directory (`claudecode.ts`, `opencode.ts`,
 * `openclaude.ts`) handle install + project wiring; they don't own the
 * runtime spawn shape — that lives here so `task-executor.ts` has one
 * place to read it.
 *
 * Engine binary auth is OUT OF SCOPE here:
 *  - `claude` reads `ANTHROPIC_API_KEY` from env.
 *  - `opencode` has its own config dir.
 *  - `openclaude` reads `.eve/openclaude.json`.
 *
 * Eve mints exactly one Hub key (`coder`) and exposes it as
 * `SYNAP_API_KEY` in the spawned env via the existing project `.env` /
 * `.claude/settings.json` wiring — see `builder-hub-wiring.ts`.
 */

import type { CodeEngine, Task } from '@eve/dna';

export interface SpawnSpec {
  command: string;
  args: string[];
}

/**
 * True when the task implies the coder role (and thus should be routed
 * through `resolveCoderSpawn` for engine-specific argv shape).
 *
 * Heuristic — keep narrow: explicit assignee/role wins, then fall back
 * to the well-known code-gen task type. We deliberately do NOT match on
 * task title text — the daemon emits structured tasks.
 */
export function isCoderTask(task: Task): boolean {
  const ctx = task.context ?? {};
  const role = ctx['role'];
  if (typeof role === 'string' && role.trim().toLowerCase() === 'coder') {
    return true;
  }
  if (task.assignedAgentId === 'coder') return true;
  if (task.type === 'code-gen') return true;
  return false;
}

/**
 * Optional per-spawn overrides supplied by an orchestrator (e.g. Hermes).
 * Each engine adapter translates these to its own CLI flags; unsupported
 * fields are silently dropped (the orchestrator is expected to log a
 * one-line warning when it knows the engine can't honour an override).
 */
export interface CoderSpawnOverrides {
  /** Override the LLM model. Mapped to engine-specific `--model` flag. */
  model?: string | null;
  /** Extra system-prompt text appended at the engine boundary. */
  promptAppend?: string | null;
}

/**
 * Pick the spawn shape for a given engine + prompt.
 *
 * Each branch matches the runtime contract of the underlying CLI. The
 * adapters in `./{claudecode,opencode,openclaude}.ts` install / configure
 * the binaries; this function decides how to invoke them once installed.
 *
 * `overrides` lets the caller (Hermes daemon) thread per-personality
 * settings through to the spawn argv. Extra/disabled tool IDs are NOT
 * translated here — they are exposed to the subprocess via env vars
 * (HERMES_EXTRA_TOOLS, HERMES_DISABLED_TOOLS) for the engine-side skill
 * loader to read at runtime.
 */
export function resolveCoderSpawn(
  engine: CodeEngine,
  prompt: string,
  overrides?: CoderSpawnOverrides,
): SpawnSpec {
  // Append personality prompt text at the engine boundary. Each engine takes
  // a single prompt string, so we concatenate rather than try to set a system
  // prompt — the latter requires engine-specific session config files.
  const finalPrompt =
    overrides?.promptAppend && overrides.promptAppend.trim().length > 0
      ? `${prompt}\n\n${overrides.promptAppend}`
      : prompt;

  const model = overrides?.model ?? undefined;

  switch (engine) {
    case 'claudecode': {
      // Anthropic's Claude Code CLI. `-p` runs a prompt non-interactively;
      // `--model` selects the underlying model. See
      // https://code.claude.com/docs/en/cli for full flag reference.
      const args = ['-p', finalPrompt];
      if (model) args.unshift('--model', model);
      return { command: 'claude', args };
    }

    case 'opencode': {
      // OpenCode CLI's headless generate path. `--model` is honoured by recent
      // versions; older builds will warn and ignore — we accept that trade-off.
      const args = ['generate', finalPrompt];
      if (model) args.splice(1, 0, '--model', model);
      return { command: 'opencode', args };
    }

    case 'openclaude': {
      // OpenClaude is invoked via its own CLI; for headless prompt-mode
      // we pass the prompt as a positional. Tool restrictions live in the
      // adapter's settings file (.eve/openclaude.json) — model can be
      // overridden via --model when supported.
      const args = ['run', finalPrompt];
      if (model) args.splice(1, 0, '--model', model);
      return { command: 'openclaude', args };
    }

    default: {
      // Exhaustiveness guard. TypeScript will catch new engine values
      // added to `CodeEngine` and not handled here.
      const _exhaustive: never = engine;
      void _exhaustive;
      return { command: 'claude', args: ['-p', finalPrompt] };
    }
  }
}
