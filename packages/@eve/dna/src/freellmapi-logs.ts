/**
 * Pure parsers over FreeLLMAPI's container logs.
 *
 * Lives in `@eve/dna` because BOTH `@eve/lifecycle` (the installer) and
 * `@eve/brain` (the `freellmapi-code` command) need them, and lifecycle already
 * depends on brain — so putting them in lifecycle would make brain's import a
 * dependency cycle. dna is the shared floor both sit on.
 *
 * Pure string in, value out: the `docker logs` call stays with the caller, so
 * these are testable without a daemon.
 */

/**
 * The CURRENT first-run setup code, or null when none is active.
 *
 * Upstream mints one at boot whenever the dashboard is unclaimed, logs it as
 * `  First-run setup code: <CODE>`, and clears it once an account exists.
 *
 *   - LAST match wins: the code is regenerated on every boot, so an earlier
 *     line in the same log is stale and would be rejected by the server.
 *   - null is a normal steady state (dashboard already claimed), not a fault.
 */
export function parseFreellmapiSetupCode(logs: string): string | null {
  // 10 chars from upstream's ambiguity-free alphabet — no I, O, 0 or 1.
  const matches = logs.match(/First-run setup code:\s*([A-HJ-NP-Z2-9]{10})/g);
  if (!matches?.length) return null;
  return matches[matches.length - 1]!.split(':')[1]!.trim();
}

/**
 * The unified API key, minted during the FIRST DB migration and printed once.
 *
 * Matched by KEY SHAPE rather than the sentence around it, so a reworded log
 * line still yields it. Last match wins so a regenerated key beats the original.
 */
export function parseFreellmapiUnifiedKey(logs: string): string | null {
  const matches = logs.match(/freellmapi-[0-9a-f]{48}/g);
  return matches?.[matches.length - 1] ?? null;
}
