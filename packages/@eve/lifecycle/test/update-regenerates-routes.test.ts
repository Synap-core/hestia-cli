/**
 * A component update regenerates the Traefik routes.
 *
 * `runAction(_, 'update')` is the door the dashboard's update button and
 * `eve update <component>` reach. Before this, no update touched
 * `/opt/traefik/dynamic/eve-routes.yml`: a route an Eve release added (the pod
 * storage route) never reached a pod until someone ran `eve domain apply` by
 * hand — and that command routed EVERY registry component, installed or not.
 *
 * Drives the REAL `runActionToCompletion('rsshub', 'update')` with docker
 * recorded (`spawn`), and asserts on the arguments the route generator
 * receives: the saved domain and the INSTALLED components, never `undefined`
 * (which means "the whole registry").
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { TraefikService } from "@eve/legs";

const state = vi.hoisted(() => ({
  pullExit: 0,
  installed: ["traefik", "synap", "rsshub"] as string[] | Error,
  domain: "example.com" as string | undefined,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((_cmd: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => {
        // `docker ps -a --filter name=^<name>$` → the container exists
        const name = /^name=\^(.+)\$$/.exec(args[3] ?? "")?.[1];
        if (args[0] === "ps" && name) child.stdout.emit("data", Buffer.from(`${name}\n`));
        child.emit("close", args[0] === "pull" ? state.pullExit : 0);
      });
      return child;
    }),
  };
});

vi.mock("@eve/dna", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@eve/dna")>();
  return {
    ...actual,
    readEveSecrets: vi.fn(async () =>
      state.domain ? { domain: { primary: state.domain, ssl: true } } : null,
    ),
    appendOperationalEvent: vi.fn(async () => {}),
    entityStateManager: {
      updateOrgan: vi.fn(async () => {}),
      updateComponentEntry: vi.fn(async () => {}),
      updateSetupProfile: vi.fn(async () => {}),
      getInstalledComponents: vi.fn(async () => {
        if (state.installed instanceof Error) throw state.installed;
        return state.installed;
      }),
    },
  };
});

describe("update regenerates the Traefik routes", () => {
  let configure: MockInstance;
  let live: MockInstance;
  beforeEach(() => {
    state.pullExit = 0;
    state.installed = ["traefik", "synap", "rsshub"];
    state.domain = "example.com";
    configure = vi
      .spyOn(TraefikService.prototype, "configureSubdomains")
      .mockResolvedValue({ changed: true });
    live = vi.spyOn(TraefikService.prototype, "readRoutesDomain").mockReturnValue({ state: "missing" });
  });
  afterEach(() => {
    configure.mockRestore();
    live.mockRestore();
  });

  it("with the installed components and the saved domain, after the update succeeded", async () => {
    const { runActionToCompletion } = await import("../src/index.js");

    const result = await runActionToCompletion("rsshub", "update");

    expect(result.ok).toBe(true);
    expect(configure).toHaveBeenCalledTimes(1);
    const [domain, ssl, , installed] = configure.mock.calls[0];
    expect(domain).toBe("example.com");
    expect(ssl).toBe(true);
    // the installed list — `undefined` would route every registry component
    expect(installed).toEqual(["traefik", "synap", "rsshub"]);
    // and an update never publishes a host the routes did not serve
    expect(configure.mock.calls[0][6]).toEqual({ keepPublicHosts: true });
    expect(result.logs).toContain("Traefik routes refreshed for example.com");
  });

  // CT101: openclaw (no gateway auth) and nango are installed, never routed.
  it("names the installed components it left unrouted, and how to publish them", async () => {
    configure.mockResolvedValue({ changed: true, notExposed: ["openclaw", "nango"] });
    const { runActionToCompletion } = await import("../src/index.js");

    const result = await runActionToCompletion("rsshub", "update");

    expect(result.ok).toBe(true);
    expect(result.logs).toContain(
      "Traefik routes refreshed for example.com; not exposed: openclaw, nango — run `eve domain apply` to publish them",
    );
  });

  it("does not touch the routes when the update failed", async () => {
    state.pullExit = 1;
    const { runActionToCompletion } = await import("../src/index.js");

    const result = await runActionToCompletion("rsshub", "update");

    expect(result.ok).toBe(false);
    expect(configure).not.toHaveBeenCalled();
  });

  it("says why when no domain is configured, and the update still succeeds", async () => {
    state.domain = undefined;
    const { runActionToCompletion } = await import("../src/index.js");

    const result = await runActionToCompletion("rsshub", "update");

    expect(result.ok).toBe(true);
    expect(configure).not.toHaveBeenCalled();
    expect(result.logs.some((l) => l.includes("not regenerated: no domain configured"))).toBe(true);
  });

  it("leaves the routes alone, and says so, when the installed components cannot be read", async () => {
    state.installed = new Error("Invalid state JSON: Unexpected token");
    const { runActionToCompletion } = await import("../src/index.js");

    const result = await runActionToCompletion("rsshub", "update");

    expect(result.ok).toBe(true);
    expect(configure).not.toHaveBeenCalled();
    expect(result.logs.some((l) => l.includes("NOT regenerated: installed components unreadable"))).toBe(true);
  });

  // CT101: the live routes come from /opt/hestia-cli/.eve, a stale /root/.eve
  // names another domain. An update run from /root must not move the pod there.
  it("leaves routes generated for another domain alone, says why, and the update still succeeds", async () => {
    live.mockReturnValue({ state: "found", domain: "antoinesrvt.synap.live", path: "/opt/traefik/dynamic/eve-routes.yml" });
    const { runActionToCompletion } = await import("../src/index.js");

    const result = await runActionToCompletion("rsshub", "update");

    expect(result.ok).toBe(true);
    expect(configure).not.toHaveBeenCalled();
    const line = result.logs.find((l) => l.includes("NOT regenerated"));
    expect(line).toContain("serves antoinesrvt.synap.live");
    expect(line).toContain("say example.com");
    expect(line).not.toContain("run: eve domain apply");
  });
});
