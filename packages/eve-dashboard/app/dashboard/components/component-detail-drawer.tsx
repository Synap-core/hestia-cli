"use client";

/**
 * Component detail drawer — slide-in from right.
 *
 * Thin wrapper around <ComponentSurface>. The drawer owns its own header
 * (title chip, refresh, full-page link, close). The surface renders the
 * body. The same surface is used by `/dashboard/components/[id]` for the
 * full-page view.
 */

import { useState } from "react";
import Link from "next/link";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter,
} from "@heroui/react";
import { RefreshCw, X, Maximize2 } from "lucide-react";
import { ComponentSurface } from "./component-surface";

export function ComponentDetailDrawer({
  componentId,
  isOpen,
  onClose,
  onChange,
}: {
  componentId: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful action that may have changed list state. */
  onChange?: () => void;
}) {
  // Bumping this re-mounts the surface, which forces a fresh fetch — used
  // by the drawer's refresh button without exposing surface internals.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      placement="right"
      size="lg"
      hideCloseButton
      classNames={{
        base: "bg-content1",
        header: "border-b border-divider",
        footer: "border-t border-divider",
      }}
    >
      <DrawerContent>
        {() => (
          <>
            <DrawerHeader className="px-6 py-4">
              <div className="flex w-full items-center justify-between gap-3">
                <span className="text-sm font-medium text-default-500">
                  Component
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setRefreshKey(k => k + 1)}
                    aria-label="Refresh"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-default-500 hover:text-foreground hover:bg-content2 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  {componentId && (
                    <Link
                      href={`/dashboard/components/${componentId}`}
                      onClick={onClose}
                      aria-label="Open full page"
                      title="Open full page"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-default-500 hover:text-foreground hover:bg-content2 transition-colors"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-default-500 hover:text-foreground hover:bg-content2 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </DrawerHeader>

            <DrawerBody className="px-6 py-6">
              {componentId && (
                <ComponentSurface
                  key={`${componentId}:${refreshKey}`}
                  componentId={componentId}
                  layout="drawer"
                  onChange={onChange}
                />
              )}
            </DrawerBody>

            <DrawerFooter className="px-6 py-3">
              <span className="text-xs text-default-400">
                Eve component drawer
              </span>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
