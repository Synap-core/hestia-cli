"use client";

/**
 * `EmptyState` — replaces the app grid when the operator has no apps.
 *
 * Greeting and search remain visible above and below — the surface
 * doesn't feel broken; the operator can still reach the marketplace.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §8
 */

import { Button } from "@heroui/react";
import { LayoutGrid } from "lucide-react";
import { CP_BASE_URL } from "../lib/cp-oauth";

export function EmptyState() {
  const marketplaceUrl = `${CP_BASE_URL}/marketplace`;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <LayoutGrid className="h-14 w-14 text-foreground/40" strokeWidth={1.4} aria-hidden />
      <h2 className="mt-6 font-heading text-2xl font-light text-foreground">
        Your OS is a blank canvas
      </h2>
      <p className="mt-2 max-w-[360px] text-[13.5px] text-foreground/55">
        Install your first app from the marketplace.
      </p>
      <Button
        as="a"
        href={marketplaceUrl}
        target="_blank"
        rel="noreferrer"
        color="primary"
        radius="full"
        size="md"
        className="mt-6 font-medium"
      >
        Browse marketplace
      </Button>
    </div>
  );
}
