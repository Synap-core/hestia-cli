"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { useOverlayStore } from "../../stores/overlay-store";

const CommandOverlay = dynamic(
  () => import("./command-overlay").then((m) => ({ default: m.CommandOverlay })),
  { ssr: false },
);
const SwitcherOverlay = dynamic(
  () => import("./switcher-overlay").then((m) => ({ default: m.SwitcherOverlay })),
  { ssr: false },
);
const AgentOverlay = dynamic(
  () => import("./agent-overlay").then((m) => ({ default: m.AgentOverlay })),
  { ssr: false },
);
const VaultPermissionOverlay = dynamic(
  () => import("./vault-permission-overlay").then((m) => ({ default: m.VaultPermissionOverlay })),
  { ssr: false },
);

export function OverlayHost() {
  const stack = useOverlayStore((s) => s.stack);
  const open = useOverlayStore((s) => s.open);
  const close = useOverlayStore((s) => s.close);
  const isOpen = useOverlayStore((s) => s.isOpen);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd+K — command palette
      if (isMod && e.key.toLowerCase() === "k" && !e.shiftKey) {
        e.preventDefault();
        isOpen("command") ? close() : open("command");
        return;
      }

      // Cmd+` — app switcher (physical Backquote key, layout-independent)
      if (isMod && e.code === "Backquote") {
        e.preventDefault();
        isOpen("switcher") ? close() : open("switcher");
        return;
      }

      // Cmd+\ — agent toggle (physical Backslash key, layout-independent)
      if (isMod && e.code === "Backslash") {
        e.preventDefault();
        isOpen("agent") ? close() : open("agent");
        return;
      }

      // Cmd+Shift+V — vault
      if (isMod && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        isOpen("vault") ? close() : open("vault");
        return;
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
      {top?.kind === "switcher" && (
        <SwitcherOverlay key={top.id} onClose={() => close(top.id)} />
      )}
      {top?.kind === "agent" && (
        <AgentOverlay
          key={top.id}
          onClose={() => close(top.id)}
          scope={top.payload?.scope as string | undefined}
        />
      )}
      {(top?.kind === "vault" || top?.kind === "permission") && (
        <VaultPermissionOverlay key={top.id} entry={top} onClose={() => close(top.id)} />
      )}
    </AnimatePresence>
  );
}
