/**
 * Client-side wrapper for the Synap CP marketplace API.
 *
 * Calls go to `${CP_BASE_URL}/api/marketplace/*` with the user-scoped
 * JWT in the `Authorization` header. On 401 we assume the token has
 * expired or been revoked and bounce the user back through the OAuth
 * flow.
 *
 * IMPORTANT: this file is "client" in the sense that it runs in the
 * browser. It does, however, fetch the bearer token from the
 * server-side proxy (`/api/secrets/cp-token`) so the token only lives
 * in memory long enough for one request. We deliberately do NOT cache
 * the token in module scope.
 *
 * Type duplication note (PR #2 spec §4):
 *   `@synap/marketplace` lives in the `synap-control-plane-api`
 *   monorepo (sibling repo) — it is NOT in the hestia-cli pnpm
 *   workspace. Adding it as a workspace dep is impossible without
 *   restructuring both repos. We mirror the response shape locally
 *   to ship Phase 2 unblocked. When the hestia-cli workspace is
 *   linked to the CP types via a published npm package or a turbo
 *   "remote workspace", swap these locals for the upstream import.
 *   Tracking marker:  TODO(eve-os-vision §4): replace local types
 *   with `import type { ListAppsResponse, ... } from "@synap/marketplace"`.
 */

import {
  CP_BASE_URL,
  getCpUserToken,
  initiateCpOAuth,
} from "./cp-oauth";

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
 * Issue a request to the CP with the user bearer token attached.
 *
 * @param onUnauthorized
 *   What to do when the CP returns 401. By default we trigger
 *   `initiateCpOAuth()` (full redirect). Tests pass a stub here so they
 *   can assert the trigger fires without actually navigating away.
 */
async function cpFetch(
  path: string,
  init: RequestInit & { onUnauthorized?: () => void } = {},
): Promise<Response> {
  const token = await getCpUserToken();
  if (!token) {
    // No token at all — same end-user effect as a 401.
    (init.onUnauthorized ?? (() => void initiateCpOAuth()))();
    throw new CpUnauthorizedError("No CP user token available");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // Default Accept for safety against gateways that strip wildcards.
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const url = `${CP_BASE_URL}${path}`;
  const res = await fetch(url, { ...init, headers });

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
  const res = await cpFetch("/api/marketplace/apps", {
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
  const res = await cpFetch("/api/marketplace/install", {
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
