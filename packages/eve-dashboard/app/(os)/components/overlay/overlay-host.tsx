"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { useOverlayStore } from "../../stores/overlay-store";

const CommandOverlay = dynamic(
  () => import("./command-overlay").then((m) => ({ default: m.CommandOverlay })),
  { ssr: false },
);

export function OverlayHost() {
  const stack = useOverlayStore((s) => s.stack);
  const open = useOverlayStore((s) => s.open);
  const close = useOverlayStore((s) => s.close);
  const isOpen = useOverlayStore((s) => s.isOpen);

  // Global Cmd+K → command overlay toggle
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen("command")) {
          close();
        } else {
          open("command");
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close, isOpen]);

  const top = stack[stack.length - 1];

  return (
    <AnimatePresence>
      {top?.kind === "command" && (
        <CommandOverlay key={top.id} onClose={() => close(top.id)} />
      )}
    </AnimatePresence>
  );
}
