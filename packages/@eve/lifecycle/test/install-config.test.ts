import { describe, expect, it } from "vitest";
import {
  gatherInstallConfig,
  InstallConfigError,
  isValidDomain,
  isValidEmail,
  normalizeBareDomain,
  type GatherInstallConfigOptions,
  type PromptFns,
  type ResolverIO,
} from "../src/install-config.js";

// ---------------------------------------------------------------------------
// IO + prompt fakes
// ---------------------------------------------------------------------------

function makeIO(over: Partial<ResolverIO> = {}): ResolverIO {
  return {
    readSecrets: async () => null,
    readSavedProfile: async () => null,
    discover: async () => ({}),
    env: {},
    ...over,
  };
}

function noPrompts(): Partial<PromptFns> {
  // Empty object — resolver should never call a prompt fn in non-interactive mode.
  return {};
}

const baseOpts: GatherInstallConfigOptions = {
  cwd: "/tmp/test",
  flags: {},
  interactive: false,
  loadSavedProfile: false,
};

// ---------------------------------------------------------------------------
// Pure validators
// ---------------------------------------------------------------------------

describe("validators", () => {
  it("accepts localhost as a domain", () => {
    expect(isValidDomain("localhost")).toBe(true);
  });
  it("accepts FQDNs", () => {
    expect(isValidDomain("pod.example.com")).toBe(true);
    expect(isValidDomain("a-b.c.io")).toBe(true);
  });
  it("rejects bare hostnames and empty strings", () => {
    expect(isValidDomain("nothing")).toBe(false);
    expect(isValidDomain("")).toBe(false);
    expect(isValidDomain(undefined)).toBe(false);
  });
  it("validates emails", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("normalizeBareDomain", () => {
  it("strips a single leading pod. prefix", () => {
    expect(normalizeBareDomain("pod.team.example.com")).toBe("team.example.com");
  });
  it("is idempotent on bare domains", () => {
    expect(normalizeBareDomain("team.example.com")).toBe("team.example.com");
  });
  it("leaves localhost and IPv4 untouched", () => {
    expect(normalizeBareDomain("localhost")).toBe("localhost");
    expect(normalizeBareDomain("10.0.0.1")).toBe("10.0.0.1");
  });
  it("returns undefined / empty unchanged", () => {
    expect(normalizeBareDomain(undefined)).toBeUndefined();
    expect(normalizeBareDomain("")).toBe("");
  });
});

describe("gatherInstallConfig — pod. prefix normalisation", () => {
  it("strips pod. from --domain so secrets stores the bare value", async () => {
    const cfg = await gatherInstallConfig({
      cwd: "/tmp/test",
      flags: { domain: "pod.team.example.com", email: "ops@example.com" },
      interactive: false,
      loadSavedProfile: false,
      io: {
        readSecrets: async () => null,
        readSavedProfile: async () => null,
        discover: async () => ({}),
        env: {},
      },
      prompts: {},
    });
    expect(cfg.domain).toBe("team.example.com");
    expect(cfg.exposure).toBe("public");
  });
});

// ---------------------------------------------------------------------------
// Resolution chain
// ---------------------------------------------------------------------------

describe("gatherInstallConfig — resolution chain", () => {
  it("flag beats secrets beats discovered beats default", async () => {
    const io = makeIO({
      readSecrets: async () => ({
        version: "1",
        updatedAt: "x",
        // ssl=false bypasses the email requirement so this test stays focused
        // on domain resolution.
        domain: { primary: "secrets.example.com", ssl: false },
      }) as never,
      discover: async () => ({ domain: "discovered.example.com" }),
    });

    // secrets > discovered when both present, since flag is empty
    let cfg = await gatherInstallConfig({ ...baseOpts, io, prompts: noPrompts() });
    expect(cfg.domain).toBe("secrets.example.com");
    expect(cfg.source.domain).toBe("secrets");
    expect(cfg.ssl).toBe(false);

    // Flag overrides secrets
    cfg = await gatherInstallConfig({
      ...baseOpts,
      io,
      flags: { domain: "flag.example.com", email: "x@y.co" },
      prompts: noPrompts(),
    });
    expect(cfg.domain).toBe("flag.example.com");
    expect(cfg.source.domain).toBe("flag");
    expect(cfg.email).toBe("x@y.co");
    expect(cfg.source.email).toBe("flag");
  });

  it("uses env LETSENCRYPT_EMAIL when no flag/secrets", async () => {
    const io = makeIO({
      env: { LETSENCRYPT_EMAIL: "env@x.co" },
      readSecrets: async () => ({
        version: "1",
        updatedAt: "x",
        domain: { primary: "pod.example.com" },
      }) as never,
    });
    const cfg = await gatherInstallConfig({ ...baseOpts, io, prompts: noPrompts() });
    expect(cfg.email).toBe("env@x.co");
    expect(cfg.source.email).toBe("env");
  });

  it("falls back to secrets.domain.email — the bug-fix path", async () => {
    // Reproduces the user-reported error: install ran with a non-localhost
    // domain in secrets but no --email flag. Resolver should pick it up.
    // Secrets store the BARE domain (no leading pod.); the resolver
    // returns it unchanged here. Consumers add their own routing prefix.
    const io = makeIO({
      readSecrets: async () => ({
        version: "1",
        updatedAt: "x",
        domain: { primary: "team.example.com", email: "ops@team.example.com" },
      }) as never,
    });
    const cfg = await gatherInstallConfig({ ...baseOpts, io, prompts: noPrompts() });
    expect(cfg.domain).toBe("team.example.com");
    expect(cfg.email).toBe("ops@team.example.com");
    expect(cfg.source.email).toBe("secrets");
    expect(cfg.ssl).toBe(true);
    expect(cfg.exposure).toBe("public");
  });

  it("loads from saved profile only when loadSavedProfile=true", async () => {
    const io = makeIO({
      readSavedProfile: async () => ({
        version: "1",
        updatedAt: "x",
        profile: "data_pod",
        network: { exposureMode: "public", synapHost: "saved.example.com" },
        synapInstall: { tlsEmail: "saved@x.co" },
      }) as never,
    });

    // loadSavedProfile=false → ignored
    let cfg = await gatherInstallConfig({ ...baseOpts, io, prompts: noPrompts() });
    expect(cfg.domain).toBe("localhost");
    expect(cfg.source.domain).toBe("default");

    // loadSavedProfile=true → consulted
    cfg = await gatherInstallConfig({
      ...baseOpts,
      io,
      loadSavedProfile: true,
      prompts: noPrompts(),
    });
    expect(cfg.domain).toBe("saved.example.com");
    expect(cfg.source.domain).toBe("saved-profile");
    expect(cfg.email).toBe("saved@x.co");
    expect(cfg.source.email).toBe("saved-profile");
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("gatherInstallConfig — error paths", () => {
  it("non-interactive + ssl + no email → InstallConfigError", async () => {
    await expect(
      gatherInstallConfig({
        ...baseOpts,
        flags: { domain: "pod.example.com" },
        prompts: noPrompts(),
      }),
    ).rejects.toThrow(InstallConfigError);
  });

  it("preseed without admin creds → InstallConfigError", async () => {
    let err: InstallConfigError | undefined;
    try {
      await gatherInstallConfig({
        ...baseOpts,
        flags: {
          domain: "localhost",
          adminBootstrapMode: "preseed",
        },
        prompts: noPrompts(),
      });
    } catch (e) {
      err = e as InstallConfigError;
    }
    expect(err).toBeInstanceOf(InstallConfigError);
    const fields = err!.missing.map((m) => m.field);
    expect(fields).toContain("adminEmail");
    expect(fields).toContain("adminPassword");
  });

  it("--from-image AND --from-source → InstallConfigError", async () => {
    await expect(
      gatherInstallConfig({
        ...baseOpts,
        flags: { domain: "localhost", fromImage: true, fromSource: true },
        prompts: noPrompts(),
      }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("ssl=false auto-defaults email so synap CLI's --email contract is met", async () => {
    // Synap CLI requires --email for any non-localhost domain (synap:1123),
    // even when SSL is off (behind-proxy mode). Eve auto-defaults to
    // noreply@<domain> so the operator isn't forced to type a fake address
    // for a non-functional field.
    const cfg = await gatherInstallConfig({
      ...baseOpts,
      flags: { domain: "pod.example.com", ssl: false },
      prompts: noPrompts(),
    });
    expect(cfg.domain).toBe("example.com"); // pod. stripped → bare
    expect(cfg.ssl).toBe(false);
    expect(cfg.email).toBe("noreply@example.com");
    expect(cfg.source.email).toBe("default");
    expect(cfg.exposure).toBe("public");
  });
});

// ---------------------------------------------------------------------------
// Component handling
// ---------------------------------------------------------------------------

describe("gatherInstallConfig — components", () => {
  it("always includes traefik", async () => {
    const cfg = await gatherInstallConfig({
      ...baseOpts,
      flags: { domain: "localhost", components: ["synap"] },
      prompts: noPrompts(),
    });
    expect(cfg.components).toContain("traefik");
    expect(cfg.components).toContain("synap");
  });

  it("default non-interactive is traefik+synap", async () => {
    const cfg = await gatherInstallConfig({
      ...baseOpts,
      flags: { domain: "localhost" },
      prompts: noPrompts(),
    });
    expect(cfg.components.sort()).toEqual(["synap", "traefik"]);
    expect(cfg.source.components).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// Interactive prompts (smoke — verify the resolver delegates correctly)
// ---------------------------------------------------------------------------

describe("gatherInstallConfig — interactive", () => {
  it("calls exposure + domain + email prompts in order", async () => {
    const calls: string[] = [];
    const prompts: Partial<PromptFns> = {
      componentSet: async () => {
        calls.push("componentSet");
        return { synap: true, traefik: true };
      },
      exposure: async () => { calls.push("exposure"); return "public"; },
      domain: async () => { calls.push("domain"); return "pod.test.io"; },
      ssl: async () => { calls.push("ssl"); return true; },
      email: async () => { calls.push("email"); return "ops@test.io"; },
      adminBootstrapMode: async () => { calls.push("adminBootstrapMode"); return "token"; },
      installMode: async () => { calls.push("installMode"); return "auto"; },
      withOpenclaw: async () => { calls.push("withOpenclaw"); return false; },
      withRsshub: async () => { calls.push("withRsshub"); return false; },
      tunnel: async () => { calls.push("tunnel"); return "none"; },
    };

    const cfg = await gatherInstallConfig({
      cwd: "/tmp/test",
      flags: {},
      interactive: true,
      loadSavedProfile: false,
      io: makeIO(),
      prompts,
    });

    // Prompt returned "pod.test.io" — normalised to bare "test.io" before storage.
    expect(cfg.domain).toBe("test.io");
    expect(cfg.email).toBe("ops@test.io");
    expect(cfg.source.email).toBe("prompt");
    // Email is prompted right after ssl=true is confirmed and no higher-priority
    // source has resolved it (no flag, no env, no secrets, no saved profile).
    expect(calls).toEqual([
      "componentSet",
      "exposure",
      "domain",
      "ssl",
      "email",
      "adminBootstrapMode",
      "installMode",
      "withOpenclaw",
      "withRsshub",
      "tunnel",
    ]);
  });

  it("interactive cancel on required field throws InstallConfigError", async () => {
    const prompts: Partial<PromptFns> = {
      exposure: async () => undefined, // user pressed Ctrl-C
    };
    await expect(
      gatherInstallConfig({
        cwd: "/tmp/test",
        flags: { components: ["synap"] },
        interactive: true,
        loadSavedProfile: false,
        io: makeIO(),
        prompts,
      }),
    ).rejects.toThrow(InstallConfigError);
  });
});
