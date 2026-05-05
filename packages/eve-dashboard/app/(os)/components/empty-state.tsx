"use client";

/**
 * `EmptyState` — replaces Zones B and C when the operator has no apps.
 *
 * Zones A (greeting) and D (search) keep rendering — the surface
 * doesn't feel broken, the operator can still reach the marketplace.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §8
 */

import { LayoutGrid } from "lucide-react";
import { CP_BASE_URL } from "../lib/cp-oauth";

export function EmptyState() {
  const marketplaceUrl = `${CP_BASE_URL}/marketplace`;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <LayoutGrid className="h-16 w-16 text-default-400" strokeWidth={1.4} aria-hidden />
      <h2 className="mt-6 font-heading text-2xl font-light text-foreground">
        Your OS is a blank canvas
      </h2>
      <p className="mt-3 max-w-[360px] text-sm text-default-500">
        Install your first app from the marketplace.
      </p>
      <a
        href={marketplaceUrl}
        target="_blank"
        rel="noreferrer"
        className="
          mt-6 inline-flex h-11 items-center justify-center rounded-full
          px-6 text-sm font-medium text-white
          transition-transform duration-200 ease-out
          hover:brightness-110 active:scale-[0.98]
        "
        style={{
          background: "linear-gradient(135deg, #10B981 0%, #34D399 100%)",
        }}
      >
        Browse marketplace
      </a>
    </div>
  );
}
