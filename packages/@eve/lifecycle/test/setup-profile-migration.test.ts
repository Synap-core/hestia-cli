import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const homeMock = vi.hoisted(() => ({ home: "" }));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => homeMock.home };
});

// Note: writeEveSecrets internally dynamic-imports './reconcile.js' and
// wraps it in try/catch. We don't mock reconcile here — its failure mode
// is already non-fatal, and the mock specifier wouldn't resolve from
// outside the @eve/dna package anyway.

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

describe("migrateSetupProfileToSecrets", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = tmp("eve-migr-cwd-");
    home = tmp("eve-migr-home-");
    homeMock.home = home;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("no-ops when no setup-profile exists", async () => {
    const { migrateSetupProfileToSecrets } = await import(
      "../src/setup-profile-migration.js"
    );
    const r = await migrateSetupProfileToSecrets(cwd);
    expect(r.migrated).toEqual([]);
  });

  it("copies network.synapHost + synapInstall.tlsEmail into secrets when missing", async () => {
    writeJson(join(cwd, ".eve", "setup-profile.json"), {
      version: "1",
      profile: "data_pod",
      updatedAt: "2026-05-10T00:00:00Z",
      network: { exposureMode: "public", synapHost: "pod.example.com" },
      synapInstall: { tlsEmail: "ops@example.com" },
    });

    const { migrateSetupProfileToSecrets } = await import(
      "../src/setup-profile-migration.js"
    );
    const r = await migrateSetupProfileToSecrets(cwd);
    expect(r.migrated.sort()).toEqual(["domain.email", "domain.primary"]);

    // writeEveSecrets writes to <cwd>/.eve/secrets/secrets.json — not homedir.
    const secretsPath = join(cwd, ".eve", "secrets", "secrets.json");
    expect(existsSync(secretsPath)).toBe(true);
    const written = JSON.parse(readFileSync(secretsPath, "utf-8")) as {
      domain?: { primary?: string; email?: string };
    };
    expect(written.domain?.primary).toBe("pod.example.com");
    expect(written.domain?.email).toBe("ops@example.com");
  });

  it("never overwrites existing secrets values", async () => {
    writeJson(join(cwd, ".eve", "setup-profile.json"), {
      version: "1",
      profile: "data_pod",
      updatedAt: "2026-05-10T00:00:00Z",
      network: { exposureMode: "public", synapHost: "saved.example.com" },
      synapInstall: { tlsEmail: "saved@example.com" },
    });
    // Pre-existing secrets at the cwd-scoped path that writeEveSecrets uses.
    const secretsDir = join(cwd, ".eve", "secrets");
    mkdirSync(secretsDir, { recursive: true });
    writeFileSync(
      join(secretsDir, "secrets.json"),
      JSON.stringify({
        version: "1",
        updatedAt: "2026-05-10T00:00:00Z",
        domain: { primary: "current.example.com", email: "current@example.com" },
      }),
    );

    const { migrateSetupProfileToSecrets } = await import(
      "../src/setup-profile-migration.js"
    );
    const r = await migrateSetupProfileToSecrets(cwd);
    expect(r.migrated).toEqual([]);

    const written = JSON.parse(
      readFileSync(join(secretsDir, "secrets.json"), "utf-8"),
    ) as { domain?: { primary?: string; email?: string } };
    expect(written.domain?.primary).toBe("current.example.com");
    expect(written.domain?.email).toBe("current@example.com");
  });

  it("ignores localhost in saved.network.synapHost", async () => {
    writeJson(join(cwd, ".eve", "setup-profile.json"), {
      version: "1",
      profile: "inference_only",
      updatedAt: "2026-05-10T00:00:00Z",
      network: { exposureMode: "local", synapHost: "localhost" },
    });
    const { migrateSetupProfileToSecrets } = await import(
      "../src/setup-profile-migration.js"
    );
    const r = await migrateSetupProfileToSecrets(cwd);
    expect(r.migrated).toEqual([]);
  });
});
