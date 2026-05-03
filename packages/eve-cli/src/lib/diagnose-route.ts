/**
 * Deep diagnostics for failing Traefik routes.
 *
 * When `eve doctor` finds a route returning 502/503/504/timeout, the generic
 * "upstream not responding" message isn't a diagnosis — it's a description
 * of the symptom. The doctor knows which container backs that route, so it
 * should:
 *
 *   1. Probe FROM inside Traefik's network to the upstream container by
 *      its docker-network hostname. This distinguishes "Traefik can't see
 *      the upstream" from "the upstream itself is broken".
 *   2. Read the upstream container's last 50 log lines.
 *   3. Match those lines against a pattern library of known issues we've
 *      hit in the field — auth-token regen, missing API key, OOM, etc.
 *
 * The result is rendered as a sub-section under the failed route so the
 * user gets a real next-step instead of having to ssh in and tail logs
 * themselves.
 *
 * Cost budget: each invocation runs 2 docker exec calls (~1s total wall
 * clock). We only ever call this from a route that's ALREADY failed —
 * never on the happy path — so the overhead is bounded by the number
 * of failing routes, not the total route count.
 */

import { execSync } from 'node:child_process';
import { COMPONENTS } from '@eve/dna';
import type { RouteProbe } from './probe-routes.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeepDiagnostic {
  /**
   * Outcome of the probe-from-Traefik step. `pending` only appears on the
   * shell return type if we couldn't even attempt the probe (no upstream
   * mapping known); the renderer treats that as a no-op.
   */
  upstreamProbe: {
    status: 'connected' | 'refused' | 'dns-failed' | 'timeout' | 'http-error' | 'unknown' | 'skipped';
    /** Short, single-line summary suitable for inline display. */
    summary: string;
    /** When the upstream returned bytes, the first ~200 chars (newline-stripped). */
    contentPreview?: string;
  };
  /** Matched log patterns, ordered most-specific first. */
  matchedPatterns: PatternMatch[];
  /** Raw log line count read (zero when we couldn't fetch logs). */
  logLineCount: number;
  /** The upstream container we examined. null when we don't know what it is. */
  upstreamContainer: string | null;
  /**
   * One single recommended fix command — picked from the highest-priority
   * matched pattern. When no pattern matched, this is a generic fallback.
   */
  recommendedFix: string;
}

interface PatternMatch {
  /** Short tag shown in the rendered output (e.g. "openclaw-auth-token"). */
  tag: string;
  /** Human-readable explanation of what the matched line means. */
  explanation: string;
  /** The exact line from the log that matched (truncated to 160 chars). */
  matchedLine: string;
  /** 1-based index into the captured log buffer. */
  lineNumber: number;
  /** Suggested fix specific to this pattern. */
  fix: string;
}

// ---------------------------------------------------------------------------
// Route → upstream mapping
// ---------------------------------------------------------------------------

/**
 * Hard-coded fallback map for routes whose subdomain doesn't match a
 * `ServiceInfo.subdomain` exactly. Rare today (the registry already covers
 * pod / openclaw / feeds / chat / eve), but listed for the audit trail
 * called out in the task brief.
 */
const FALLBACK_ROUTE_TO_CONTAINER: Record<string, { container: string; port: number }> = {
  pod: { container: 'synap-backend-backend-1', port: 4000 },
  openclaw: { container: 'eve-arms-openclaw', port: 3000 },
  feeds: { container: 'eve-eyes-rsshub', port: 1200 },
  chat: { container: 'hestia-openwebui', port: 8080 },
  eve: { container: 'eve-dashboard', port: 3000 },
};

/** Resolve a failed route to (container, port) by component-registry lookup. */
function resolveUpstream(route: RouteProbe): { container: string; port: number } | null {
  // First try the registry — it's the source of truth.
  const fromRegistry = COMPONENTS.find(c => c.service?.subdomain && c.id === route.id);
  if (fromRegistry?.service) {
    return {
      container: fromRegistry.service.containerName,
      port: fromRegistry.service.internalPort,
    };
  }

  // Fallback: derive subdomain from hostname (`openclaw.example.com` → `openclaw`).
  const subdomain = route.host.split('.')[0];
  const sd = FALLBACK_ROUTE_TO_CONTAINER[subdomain];
  if (sd) return sd;

  // Last-ditch: scan registry for matching subdomain.
  const bySubdomain = COMPONENTS.find(c => c.service?.subdomain === subdomain);
  if (bySubdomain?.service) {
    return {
      container: bySubdomain.service.containerName,
      port: bySubdomain.service.internalPort,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pattern library — most specific first
// ---------------------------------------------------------------------------

/**
 * Runtime context fed to patterns that want richer signals than the log
 * buffer alone. Read once per `diagnoseFailedRoute` call (one `docker
 * inspect`) and shared across every pattern check for that container.
 *
 * Currently only `sigterm-loop` consumes the context (to suppress
 * false-positives on healthy containers that received a single SIGTERM
 * during a normal `eve update`). Adding more context-aware patterns
 * means extending this shape and the `gather` helper that fills it in.
 */
interface PatternContext {
  /** `docker inspect --format '{{.RestartCount}}'`. -1 if unreadable. */
  restartCount: number;
  /** Wall-clock seconds since `StartedAt`. -1 if unreadable. */
  uptimeSec: number;
}

interface KnownPattern {
  tag: string;
  /**
   * Optional component scope. When set, the pattern only fires if the
   * upstream container matches. Avoids false positives like an OpenAI-key
   * pattern matching a log line in a totally unrelated container that
   * happened to mention OpenAI.
   */
  scopeContainer?: string;
  /** Compiled regex tested against each log line. First-match-wins per pattern. */
  match: RegExp;
  explanation: string;
  fix: string;
  /**
   * Higher = checked first. When two patterns match the same line, the
   * one with higher priority is preferred. Within the same priority,
   * the first to appear in the log wins.
   */
  priority: number;
  /**
   * Optional richer match function. When set, the pattern's regex is
   * evaluated FIRST (so we don't pay the cost of a custom callback on
   * every line); on a hit, `confirm` is called to either accept or
   * reject the match using the line index, full log buffer, and
   * runtime context. Returning `false` discards the hit and the
   * matcher continues scanning. Used by `sigterm-loop` to avoid
   * firing on a single, expected SIGTERM during a normal restart.
   */
  confirm?: (args: {
    line: string;
    lineIndex: number;
    logLines: string[];
    context: PatternContext;
  }) => boolean;
}

const KNOWN_PATTERNS: KnownPattern[] = [
  // Most specific OpenClaw failure modes ────────────────────────────────────
  {
    tag: 'openclaw-auth-regen',
    scopeContainer: 'eve-arms-openclaw',
    match: /auth token was missing|Generated a new token/i,
    explanation:
      'OpenClaw regenerated its auth token. Public domain origin probably no longer in `gateway.controlUi.allowedOrigins`.',
    fix:
      'Run `eve mode reconcile-openclaw` if available; otherwise `docker restart eve-arms-openclaw eve-legs-traefik && eve doctor`.',
    priority: 100,
  },
  {
    tag: 'openclaw-no-openai',
    scopeContainer: 'eve-arms-openclaw',
    match: /No API key found for provider "openai"/i,
    explanation: 'OpenClaw needs an OpenAI key but none is wired in.',
    fix:
      '`eve ai providers add openai --api-key <key> && eve ai apply` — or switch to Ollama via `eve ai set-service openclaw ollama && eve ai apply`.',
    priority: 95,
  },
  // Process-level failures ──────────────────────────────────────────────────
  {
    tag: 'oom-killed',
    match: /out of memory|OOMKilled|killed[: ]/i,
    explanation: 'Container was OOM-killed by the kernel.',
    fix: 'Increase the memory limit in the components compose file or free system memory.',
    priority: 90,
  },
  {
    tag: 'eaddrinuse',
    match: /EADDRINUSE/i,
    explanation: 'Port collision — another process is using the bind port.',
    fix: 'Stop the conflicting process, then restart the container.',
    priority: 85,
  },
  {
    tag: 'permission-denied',
    match: /(permission denied|EACCES)/i,
    explanation: 'File or volume permission issue at startup.',
    fix: 'Check the volume mounts ownership: `docker exec <container> ls -la /data`.',
    priority: 80,
  },
  {
    tag: 'connection-refused',
    match: /ECONNREFUSED|connection refused/i,
    explanation: 'Upstream not listening on the expected port — startup script may not have bound yet.',
    fix: 'Wait 10s and re-run `eve doctor`. If it persists, check the container startup script.',
    priority: 75,
  },
  // Lifecycle / runtime ─────────────────────────────────────────────────────
  {
    tag: 'migration-running',
    match: /\bMigration\b|\brunning migrations\b|\bmigrate(?:\.ts)?\b/,
    explanation: 'Schema migration appears to be running mid-startup.',
    fix: 'Wait 30s and re-run `eve doctor` — the container should accept traffic once migrations finish.',
    priority: 70,
  },
  {
    tag: 'healthcheck-failing',
    match: /healthcheck failing|unhealthy|health[- ]check failed/i,
    explanation: 'Healthcheck endpoint is unreachable.',
    fix: "Inspect the container's HEALTHCHECK config: `docker inspect <container> --format '{{json .Config.Healthcheck}}'`.",
    priority: 65,
  },
  {
    tag: 'sigterm-loop',
    match: /SIGTERM received|shutting down|received signal terminat(ed|ing)/i,
    explanation: 'Container is restart-looping (received SIGTERM near the end of its log).',
    fix: 'Check the components full log: `eve logs <component>`. Look for the line right BEFORE SIGTERM.',
    priority: 60,
    /**
     * Suppress false positives. A single SIGTERM during a normal `eve
     * update` is expected — the container is told to stop, then a fresh
     * one is started. Old behavior fired the pattern on any single match
     * near the tail of the log and lit up healthy containers (uptime 5
     * minutes, 0 restarts) with a misleading "restart-looping" warning.
     *
     * New rule, two cumulative gates:
     *
     *   (1) The Docker runtime says the container is healthy. If
     *       `RestartCount === 0` AND uptime > 60s, this is NOT a loop
     *       regardless of what the logs say. Skip the pattern entirely.
     *
     *   (2) When the runtime can't tell us (inspect failed) OR the
     *       runtime DOES suggest something is off, require strong
     *       log signal: either MULTIPLE SIGTERMs in the captured
     *       window (≥2) OR a SIGTERM in the LAST 5 lines (very
     *       recent kill suggests an in-progress crash).
     */
    confirm: ({ line, lineIndex, logLines, context }) => {
      // Gate 1 — runtime says we're fine.
      if (context.restartCount === 0 && context.uptimeSec > 60) return false;

      // Gate 2 — log strength.
      const sigtermPattern = /SIGTERM received|shutting down|received signal terminat(ed|ing)/i;
      let count = 0;
      for (const l of logLines) {
        if (sigtermPattern.test(l)) count += 1;
        if (count >= 2) break;
      }
      if (count >= 2) return true;

      // Single hit — only trust it if it's very near the tail (last 5 lines).
      const distanceFromEnd = logLines.length - 1 - lineIndex;
      void line; // intentionally unused — `lineIndex` already pinpoints the hit
      return distanceFromEnd >= 0 && distanceFromEnd < 5;
    },
  },
];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run a deep diagnostic on a failed route. Caller decides what counts as
 * "failed" — typically anything where `RouteProbe.outcome !== 'ok'`. We
 * never run this for healthy routes (cost budget).
 *
 * Returns one `DeepDiagnostic` describing what we learned about the
 * upstream. The function NEVER throws — every failure mode (missing
 * docker, container removed, log read timeout) becomes part of the
 * returned shape.
 */
export async function diagnoseFailedRoute(route: RouteProbe): Promise<DeepDiagnostic> {
  const upstream = resolveUpstream(route);
  if (!upstream) {
    return {
      upstreamProbe: {
        status: 'unknown',
        summary: `No upstream mapping known for route ${route.host} — registry has no matching component.`,
      },
      matchedPatterns: [],
      logLineCount: 0,
      upstreamContainer: null,
      recommendedFix:
        `Run \`docker logs <container> --tail 50\` for whatever container should back ${route.host}.`,
    };
  }

  const upstreamProbe = probeFromTraefik(upstream.container, upstream.port);
  const logBuffer = readUpstreamLogs(upstream.container);
  const context = gatherPatternContext(upstream.container);
  const matchedPatterns = matchLogPatterns(upstream.container, logBuffer, context);

  const recommendedFix = matchedPatterns.length > 0
    ? matchedPatterns[0].fix
    : `No known issue matched in last ${logBuffer.length} log lines. Run \`eve logs ${upstream.container}\` for the full log.`;

  return {
    upstreamProbe,
    matchedPatterns,
    logLineCount: logBuffer.length,
    upstreamContainer: upstream.container,
    recommendedFix,
  };
}

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------

/**
 * Probe the upstream from inside Traefik's network so we test the same path
 * Traefik takes. We use `wget -q -O -` (the busybox-y form is portable across
 * Alpine images) with a hard timeout. Disambiguating the failure mode is the
 * point of this probe — "DNS failed" tells the user the network is wrong;
 * "refused" tells them the container isn't listening; "connected" tells them
 * the upstream is fine and Traefik's config is the problem.
 */
function probeFromTraefik(container: string, port: number): DeepDiagnostic['upstreamProbe'] {
  const url = `http://${container}:${port}`;
  // Spawn synchronously so we get a clean stdout/stderr/exit triple. Hard
  // 6s wall-clock cap (5s network timeout + 1s startup margin).
  let stdout = '';
  let stderr = '';
  let exitCode = -1;
  try {
    stdout = execSync(
      `docker exec eve-legs-traefik sh -c 'wget -q -O - --timeout=5 ${url} 2>&1 || echo "WGET_EXIT=$?"'`,
      { encoding: 'utf-8', timeout: 6000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    exitCode = 0;
  } catch (err: unknown) {
    // execSync throws when exit != 0 OR on timeout. Unpack what we can.
    if (typeof err === 'object' && err !== null) {
      const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      exitCode = e.status ?? -1;
      stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf-8') ?? '';
      stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf-8') ?? '';
    }
  }

  const combined = (stdout + '\n' + stderr).trim();

  // Most reliable wins: explicit error strings from wget/getaddrinfo.
  if (/bad address|nslookup|getaddrinfo|name or service not known|could not resolve/i.test(combined)) {
    return {
      status: 'dns-failed',
      summary: `DNS lookup failed for ${container} from inside Traefik — container not on eve-network`,
    };
  }
  if (/connection refused/i.test(combined)) {
    return {
      status: 'refused',
      summary: `${container}:${port} refused connection — process not listening on that port`,
    };
  }
  if (/timed out|timeout/i.test(combined) && exitCode !== 0) {
    return {
      status: 'timeout',
      summary: `Connection to ${container}:${port} timed out — container is up but unresponsive`,
    };
  }

  // We got bytes — interpret as either a successful probe (exit 0) or
  // an HTTP error from wget that returned a body anyway.
  if (exitCode === 0 && stdout.length > 0) {
    const preview = stdout.replace(/\s+/g, ' ').trim().slice(0, 200);
    return {
      status: 'connected',
      summary: `Connected to ${container}:${port} from Traefik — upstream is reachable`,
      contentPreview: preview,
    };
  }

  if (combined.length > 0) {
    return {
      status: 'http-error',
      summary: `${container}:${port} reachable but returned an error: ${combined.slice(0, 160)}`,
    };
  }

  return {
    status: 'unknown',
    summary: `Could not probe ${container}:${port} from inside Traefik (exit ${exitCode})`,
  };
}

/**
 * Read the upstream's last 50 log lines via `docker logs`. Returns an
 * array of lines (no trailing newlines). Empty array on any failure —
 * the caller renders the empty state cleanly.
 */
function readUpstreamLogs(container: string): string[] {
  try {
    const out = execSync(`docker logs ${container} --tail 50 2>&1`, {
      encoding: 'utf-8',
      timeout: 4000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.split(/\r?\n/).filter(l => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * Walk the log buffer once per pattern (priority-ordered) and collect every
 * match. We dedup by tag (a single tag matches at most once — multiple line
 * hits within the same pattern aren't useful to render). Within a tag, we
 * keep the FIRST hit so the line number points at the originating event,
 * not the latest restart-loop echo.
 *
 * Patterns may opt into context-aware matching via a `confirm()` callback.
 * The regex still runs first (cheap path), and `confirm` only fires when
 * a line matches — keeping the per-line cost low. See `KnownPattern.confirm`.
 */
function matchLogPatterns(
  container: string,
  logLines: string[],
  context: PatternContext,
): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const seenTags = new Set<string>();

  // Priority-sort once so "most specific first" is meaningful.
  const ordered = [...KNOWN_PATTERNS].sort((a, b) => b.priority - a.priority);

  for (const pattern of ordered) {
    if (seenTags.has(pattern.tag)) continue;
    if (pattern.scopeContainer && pattern.scopeContainer !== container) continue;
    for (let i = 0; i < logLines.length; i += 1) {
      const line = logLines[i];
      if (!pattern.match.test(line)) continue;

      // Optional confirmation gate — used by sigterm-loop to suppress
      // false positives on a single, expected SIGTERM during normal
      // shutdown.
      if (pattern.confirm && !pattern.confirm({ line, lineIndex: i, logLines, context })) {
        continue;
      }

      matches.push({
        tag: pattern.tag,
        explanation: pattern.explanation,
        matchedLine: line.length > 160 ? `${line.slice(0, 160)}…` : line,
        lineNumber: i + 1,
        fix: pattern.fix,
      });
      seenTags.add(pattern.tag);
      break;
    }
  }

  return matches;
}

/**
 * Gather the runtime context patterns may consult. One `docker inspect`
 * call per failed route — bounded cost, never invoked for healthy routes.
 *
 * Format string returns `<RestartCount>|<StartedAt>` so we get both fields
 * in a single shell-out. Anything that goes wrong (container missing,
 * docker daemon down, parse error) returns sentinel `-1`s, and the
 * patterns that consume the context treat those as "unknown" — they
 * fall back to log-only signals.
 */
function gatherPatternContext(container: string): PatternContext {
  try {
    const out = execSync(
      `docker inspect ${container} --format '{{.RestartCount}}|{{.State.StartedAt}}'`,
      { encoding: 'utf-8', timeout: 4000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    const [restartStr, startedAtStr] = out.split('|');
    const restartCount = Number.parseInt(restartStr, 10);

    let uptimeSec = -1;
    if (startedAtStr) {
      const startedMs = Date.parse(startedAtStr);
      if (Number.isFinite(startedMs)) {
        uptimeSec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
      }
    }

    return {
      restartCount: Number.isFinite(restartCount) ? restartCount : -1,
      uptimeSec,
    };
  } catch {
    return { restartCount: -1, uptimeSec: -1 };
  }
}
