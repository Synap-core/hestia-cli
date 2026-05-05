/**
 * Client-side wrapper for the Synap CP marketplace.
 *
 * Calls go to **same-origin `/api/marketplace/*` proxies** on Eve's
 * Next.js server, NOT directly to the CP. The proxy attaches the
 * bearer token from disk and forwards to `api.synap.live`. This:
 *
 *   • Kills CORS — the browser never crosses origins, so self-hosted
 *     Eve at any custom domain works without per-tenant allow-listing.
 *   • Keeps the token off the browser — JWT lives only in
 *     `~/.eve/secrets.json` after the initial sign-in write.
 *   • Survives token rotation (refresh + device flow) without
 *     touching this file — all the auth machinery lives server-side.
 *
 * Type duplication note (PR #2 spec §4):
 *   `@synap/marketplace` lives in the `synap-control-plane-api`
 *   monorepo (sibling repo) — it is NOT in the hestia-cli pnpm
 *   workspace. We mirror the response shape locally. When the
 *   workspace is linked to CP types via a published npm package,
 *   swap these locals for the upstream import.
 */

import { initiateCpOAuth } from "./cp-oauth";

// ─── Type mirror of @synap/marketplace ────────────────────────────────────────
// MUST stay in sync with synap-control-plane-api/packages/marketplace-types/src/index.ts

export type AppType = "url" | "eve_component" | "workspace_pack" | "bundle";
export type AppStatus = "draft" | "published" | "archived";
export type EntitlementSource = "manual" | "stripe" | "beta" | "free";
export type EntitlementStatus = "active" | "revoked" | "expired";

export interface Pricing {
  model: "free" | "one_time" | "subscription";
  amount?: number;
  currency?: string;
  interval?: "month" | "year";
  stripePriceId?: string;
}

export interface MarketplaceApp {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  category: string;
  appType: AppType;
  appUrl: string | null;
  pricing: Pricing | null;
  metadata: Record<string, unknown> | null;
  status: AppStatus | string;
  installCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Entitlement {
  id: string;
  userId: string;
  appId: string;
  grantedAt: string;
  expiresAt: string | null;
  source: EntitlementSource;
  stripeSubscriptionId: string | null;
  status: EntitlementStatus;
}

export interface MarketplaceAppWithEntitlement extends MarketplaceApp {
  entitled: boolean;
  entitlement?: Entitlement;
}

export interface ListAppsResponse {
  apps: MarketplaceAppWithEntitlement[];
}

export interface InstallRequest {
  slug?: string;
  appId?: string;
}

export interface InstallResponse {
  app: MarketplaceApp;
  entitlement: Entitlement | null;
  installed: boolean;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown when the user is not authenticated. Treat as "kick to OAuth".
 * Distinct from generic network errors so the UI can render different
 * states ("sign in" vs "retry").
 */
export class CpUnauthorizedError extends Error {
  constructor(message = "Not authenticated with Synap CP") {
    super(message);
    this.name = "CpUnauthorizedError";
  }
}

/** Thrown when the marketplace is reachable but returns a non-401 error. */
export class MarketplaceError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MarketplaceError";
    this.status = status;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Issue a request to the **same-origin Eve marketplace proxy**.
 *
 * Path is the slug under `/api/marketplace/*` (e.g. `apps`, `install`).
 * The proxy on the Eve server is responsible for attaching the bearer
 * from disk and forwarding upstream. The browser never has the token
 * after the initial sign-in write.
 *
 * @param onUnauthorized
 *   What to do when the upstream CP returns 401. By default we trigger
 *   `initiateCpOAuth()` (full redirect). Tests pass a stub.
 *
 * The `requireAuth` flag is gone — the proxy enforces it where needed.
 * `/api/marketplace/apps` happily serves anonymous; `/api/marketplace/install`
 * 401s without a token. Both surface 401 the same way to this client.
 */
async function cpFetch(
  slug: string,
  init: RequestInit & { onUnauthorized?: () => void } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const url = `/api/marketplace/${slug.replace(/^\//, "")}`;
  const res = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });

  if (res.status === 401) {
    (init.onUnauthorized ?? (() => void initiateCpOAuth()))();
    throw new CpUnauthorizedError();
  }

  return res;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List the apps the current CP user is entitled to (plus visible-but-
 * locked apps with a "Buy" CTA, per Phase 1 entitlement model).
 *
 * @param opts.onUnauthorized
 *   Override the default "redirect to OAuth" behavior. Useful for tests
 *   and for headless calls where we want to surface the auth state via
 *   a banner instead of leaving the page.
 */
export async function fetchMarketplaceApps(opts: {
  onUnauthorized?: () => void;
} = {}): Promise<ListAppsResponse> {
  const res = await cpFetch("apps", {
    method: "GET",
    onUnauthorized: opts.onUnauthorized,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new MarketplaceError(
      `Marketplace listing failed (${res.status}): ${text.slice(0, 240)}`,
      res.status,
    );
  }
  const json = (await res.json()) as ListAppsResponse;
  return json;
}

/**
 * Trigger an install on the CP. For `workspace_pack` and
 * `eve_component` apps this also kicks off the type-specific
 * downstream flow on the server side; for `url` apps it just records
 * the click + increments install_count.
 *
 * Pass either `slug` (preferred — human readable) or `appId`.
 */
export async function installApp(
  ref: InstallRequest,
  opts: { onUnauthorized?: () => void } = {},
): Promise<InstallResponse> {
  if (!ref.slug && !ref.appId) {
    throw new Error("installApp requires either { slug } or { appId }");
  }
  const res = await cpFetch("install", {
    method: "POST",
    body: JSON.stringify(ref),
    onUnauthorized: opts.onUnauthorized,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new MarketplaceError(
      `Install failed (${res.status}): ${text.slice(0, 240)}`,
      res.status,
    );
  }
  return (await res.json()) as InstallResponse;
}
