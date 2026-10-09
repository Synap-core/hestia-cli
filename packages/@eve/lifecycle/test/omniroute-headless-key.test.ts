/**
 * OmniRoute headless key + provider-list upsert.
 *
 * `mintOmniRouteKey` takes its transport as a parameter, so the chain is
 * asserted on the REAL request sequence (paths, bodies, the bearer handed from
 * step 1 to step 2) without docker. The body field is `name` on purpose: the
 * image's bundled openapi.yaml says `label`, and the handler rejects that.
 *
 * `upsertAiProvider` pins the bug it replaced: `writeEveSecrets` merges `ai`
 * shallowly, so writing `{providers:[omniroute]}` wiped every other stored key.
 *
 * NOT covered here: that the real image accepts this chain. That was measured
 * against a scratch container (see the doc comment on mintOmniRouteKey).
 */
import { describe, expect, it } from "vitest";
import { mintOmniRouteKey, upsertAiProvider } from "../src/index.js";

describe("mintOmniRouteKey", () => {
  it("connects with the password, then mints a key with the returned bearer", () => {
    const calls: Array<{ path: string; body: unknown; bearer?: string }> = [];
    const post = (path: string, body: unknown, bearer?: string) => {
      calls.push({ path, body, bearer });
      return path === "/api/cli/connect"
        ? { success: true, token: "oma_live_T" }
        : { key: "sk-minted" };
    };
    expect(mintOmniRouteKey("pw", post)).toEqual({ key: "sk-minted" });
    expect(calls).toEqual([
      { path: "/api/cli/connect", body: { password: "pw", name: "eve", scope: "admin" }, bearer: undefined },
      { path: "/api/keys", body: { name: "synap-intelligence" }, bearer: "oma_live_T" },
    ]);
  });

  it("returns an error, and never calls /api/keys, when the password is refused", () => {
    const paths: string[] = [];
    const post = (path: string) => {
      paths.push(path);
      return { success: false, error: "invalid password" };
    };
    const out = mintOmniRouteKey("wrong", post);
    expect(out).toMatchObject({ error: expect.stringContaining("cli/connect refused") });
    expect(paths).toEqual(["/api/cli/connect"]);
  });

  it("never throws when the transport fails", () => {
    const post = () => {
      throw new Error("docker: not found\nmore");
    };
    expect(mintOmniRouteKey("pw", post)).toEqual({ error: "docker: not found" });
  });
});

describe("upsertAiProvider", () => {
  it("keeps every other provider when adding omniroute", () => {
    const existing = [
      { id: "anthropic", apiKey: "sk-ant" },
      { id: "openrouter", apiKey: "sk-or" },
    ];
    const next = upsertAiProvider(existing, { id: "omniroute", apiKey: "sk-omni" });
    expect(next.map((p) => p.id)).toEqual(["anthropic", "openrouter", "omniroute"]);
    expect(next.find((p) => p.id === "anthropic")?.apiKey).toBe("sk-ant");
  });

  it("replaces an existing omniroute entry in place", () => {
    const next = upsertAiProvider(
      [{ id: "omniroute", apiKey: "old" }, { id: "x", apiKey: "y" }],
      { id: "omniroute", apiKey: "new" },
    );
    expect(next).toEqual([{ id: "omniroute", apiKey: "new" }, { id: "x", apiKey: "y" }]);
  });
});
