/**
 * Single source of truth for the public marketplace URL.
 *
 * Lives at https://www.synap.live/marketplace (the synap-landing public
 * catalog). Override at build time with NEXT_PUBLIC_MARKETPLACE_URL when
 * pointing at a staging landing or running everything locally.
 *
 * NOT the CP. The CP exposes `GET /api/marketplace/apps` (data) but no
 * UI — the catalog page is on the marketing site so it has SEO equity
 * and the design system without us re-implementing it under cp.synap.sh.
 *
 * See: synap-team-docs/content/team/platform/marketplace-landing-design.mdx
 */

export const MARKETPLACE_URL: string =
  (process.env.NEXT_PUBLIC_MARKETPLACE_URL || "https://www.synap.live/marketplace").replace(/\/+$/, "");

/** Per-app deep-link inside the marketplace landing. */
export function marketplaceAppUrl(slug: string): string {
  return `${MARKETPLACE_URL}/${encodeURIComponent(slug)}`;
}
