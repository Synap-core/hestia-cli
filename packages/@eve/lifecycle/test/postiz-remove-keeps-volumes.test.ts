/**
 * `remove postiz` must never delete its volumes.
 *
 * The generic lifecycle remove (also what the dashboard's remove button calls)
 * runs `docker compose down --volumes` for every compose component except the
 * ones in KEEP_VOLUMES_ON_REMOVE. Postiz's volumes hold every scheduled post,
 * the connected social accounts and the owner account, so a remove-to-reinstall
 * that wiped them would be silent data loss behind a routine verb.
 *
 * Drives the REAL `runAction('postiz', 'remove')` with `spawn` recorded, so the
 * assertion is on the argv docker would actually receive — not on the set's
 * contents. `existsSync` is faked true for /opt/postiz only (the remove skips
 * compose when the dir is missing), and the state writes are stubbed so the
 * test never touches ~/.eve.
 *
 * Does NOT cover: the CLI's own `removePostiz`, which delegates to this same
 * path (a separate inline `compose down` there would escape this guard).
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((cmd: string, args: string[], opts: { cwd?: string } = {}) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => child.emit("close", 0));
      return child;
    }),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (p: Parameters<typeof actual.existsSync>[0]) =>
      p === "/opt/postiz" ? true : actual.existsSync(p),
  };
});

vi.mock("@eve/dna", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@eve/dna")>();
  return {
    ...actual,
    entityStateManager: {
      updateOrgan: vi.fn(async () => {}),
      updateComponentEntry: vi.fn(async () => {}),
      getInstalledComponents: vi.fn(async () => ["traefik", "synap", "postiz"]),
      updateSetupProfile: vi.fn(async () => {}),
    },
  };
});

function destroysVolumes(argv: string[]): boolean {
  const line = argv.join(" ");
  return (
    argv.includes("--volumes") ||
    /\bdown\b.*\s-v(\s|$)/.test(line) ||
    /\bvolume\s+(prune|rm)\b/.test(line)
  );
}

describe("remove postiz", () => {
  it("brings the compose project down WITHOUT deleting its volumes", async () => {
    const { runActionToCompletion } = await import("../src/index.js");
    calls.length = 0;

    const result = await runActionToCompletion("postiz", "remove");

    expect(result.ok).toBe(true);
    // Non-vacuity: the remove really reached its compose teardown in the
    // Postiz dir — a run that skipped compose would pass the next line too.
    const down = calls.find((c) => c.args[0] === "compose" && c.args[1] === "down");
    expect(down).toBeDefined();
    expect(down?.cwd).toBe("/opt/postiz");

    expect(calls.filter((c) => destroysVolumes(c.args))).toEqual([]);
    expect(result.logs.some((l) => l.includes("volumes kept"))).toBe(true);
  });

  it("the volume detector sees the command the generic remove issues for other components", () => {
    expect(destroysVolumes(["compose", "down", "--volumes"])).toBe(true);
    expect(destroysVolumes(["compose", "down", "-v"])).toBe(true);
    expect(destroysVolumes(["compose", "down"])).toBe(false);
  });
});
