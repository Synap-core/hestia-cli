/**
 * Smoke tests for the Eve↔CP OAuth client (PKCE).
 *
 * Coverage (per PR #2 spec §6):
 *   • PKCE: code_challenge is BASE64URL(SHA256(code_verifier))
 *   • State generator produces unique tokens
 *   • fetchMarketplaceApps uses the same-origin marketplace proxy
 *   • 401 response triggers the re-auth callback
 *
 * The OAuth helpers live in the browser, so we stub `sessionStorage`,
 * `window.location`, and `fetch` at module scope before importing the
 * code under test. Crypto + btoa are native in Node 18+ so they need
 * no shim.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// ─── Test-time DOM shims ──────────────────────────────────────────────────────
// Set up BEFORE importing the modules under test so their top-level
// `process.env.NEXT_PUBLIC_CP_BASE_URL` read happens with our env in place.

beforeEach(() => {
  process.env.NEXT_PUBLIC_CP_BASE_URL = "https://cp.test.synap.sh";

  // Minimal sessionStorage. Only get/set/removeItem are exercised.
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    },
  });

  // window.location.origin is the only piece we need.
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "http://localhost:7979",
        href: "http://localhost:7979/",
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  delete (globalThis as { window?: unknown }).window;
});

// ─── PKCE primitives ──────────────────────────────────────────────────────────

describe("PKCE generation", () => {
  it("produces a base64url challenge that matches SHA256(verifier)", async () => {
    const { generateCodeVerifier, generateCodeChallenge, base64UrlEncode } =
      await import("../cp-oauth");

    const verifier = generateCodeVerifier();

    // Verifier is base64url, no padding, 43 chars (32 bytes → 43 b64url).
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);

    const challenge = await generateCodeChallenge(verifier);

    // Independently compute SHA256 in node and compare.
    const expected = base64UrlEncode(
      new Uint8Array(createHash("sha256").update(verifier).digest()),
    );
    expect(challenge).toBe(expected);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // Padding must be stripped per RFC 7636.
    expect(challenge).not.toContain("=");
  });
});

// ─── State generator ──────────────────────────────────────────────────────────

describe("generateState", () => {
  it("returns a different value on every call", async () => {
    const { generateState } = await import("../cp-oauth");

    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateState());

    // 50 16-byte random tokens collide with cosmologically tiny
    // probability — equality here means the generator is broken.
    expect(seen.size).toBe(50);
    for (const v of seen) expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// ─── fetchMarketplaceApps: same-origin marketplace proxy ─────────────────────

describe("fetchMarketplaceApps", () => {
  it("calls the same-origin marketplace proxy without exposing a bearer", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (input.endsWith("/api/marketplace/apps")) {
        return new Response(JSON.stringify({ apps: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchMarketplaceApps } = await import("../marketplace-client");
    const result = await fetchMarketplaceApps();

    expect(result).toEqual({ apps: [] });

    // The browser calls Eve's same-origin proxy. The proxy attaches
    // server-side auth, so the browser must not expose the bearer.
    const cpCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/marketplace/apps"),
    );
    expect(cpCall).toBeDefined();

    const init = cpCall![1] as RequestInit | undefined;
    expect(init).toBeDefined();
    const headers = new Headers(init!.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(init!.credentials).toBe("include");
  });

  it("triggers re-auth on 401", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (input === "/api/secrets/cp-token") {
        return new Response(
          JSON.stringify({ userToken: "expired.jwt.tok" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (input.endsWith("/api/marketplace/apps")) {
        return new Response("Unauthorized", { status: 401 });
      }
      throw new Error(`Unexpected fetch ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchMarketplaceApps, CpUnauthorizedError } = await import(
      "../marketplace-client"
    );

    const onUnauthorized = vi.fn();

    await expect(
      fetchMarketplaceApps({ onUnauthorized }),
    ).rejects.toBeInstanceOf(CpUnauthorizedError);

    // The override is called exactly once on the 401 path. We assert
    // the override (rather than spying on initiateCpOAuth) because
    // the override is the real public contract — it's what production
    // hosts will pass in to wire up their banner.
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not read the CP token before listing marketplace apps", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (input.endsWith("/api/marketplace/apps")) {
        return new Response(JSON.stringify({ apps: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchMarketplaceApps } = await import("../marketplace-client");

    const onUnauthorized = vi.fn();
    await expect(fetchMarketplaceApps({ onUnauthorized })).resolves.toEqual({ apps: [] });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.find(([url]) =>
        String(url) === "/api/secrets/cp-token",
      ),
    ).toBeUndefined();
  });
});
