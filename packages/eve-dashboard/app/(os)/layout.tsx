/**
 * Eve OS shell layout — composes the three layers every app inherits:
 *
 *   1. Wallpaper  — fixed animated mesh-gradient (z-0)
 *   2. Pane + Companion row — frosted popup pane plus an optional
 *      side-docked companion surface (z-10)
 *   3. Dock       — bottom pill app launcher (z-20)
 *   4. OverlayHost — overlays (command/switcher/agent/vault/...) (z-30)
 *
 * Routes outside this group (`/login`, `/auth/callback`) deliberately
 * skip the shell — they predate it and need their own chrome.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §6
 */

import type { ReactNode } from "react";
import { Wallpaper } from "./components/wallpaper";
import { Dock } from "./components/dock";
import { PinContextProvider } from "./components/pin-context";
import { OverlayHost } from "./components/overlay/overlay-host";
import { PaneCompanionRow } from "./components/pane-companion-row";
import { CompanionHotkeyBridge } from "./components/companion-hotkey-bridge";
import { ScopeProvider } from "@/lib/scope";

/**
 * Eve OS sits **above** any single workspace — the operator sees their whole
 * pod, not one workspace's lens. Every pod query issued from inside this
 * subtree therefore defaults to user-wide via the `usePodQuery` helper:
 *   - prefers `.listAll` procedures (entities, proposals, notifCenter, …)
 *   - reverts to per-workspace fan-out via `workspaces.list` for procedures
 *     that don't expose a user-wide variant yet (compat path)
 *
 * Surfaces that need a specific workspace lens (drilling into one workspace
 * inside Eve) can nest `<ScopeProvider scope={{ kind: "workspace", id }}>`
 * locally — the nearest provider wins.
 */
export default function OSLayout({ children }: { children: ReactNode }) {
  return (
    <ScopeProvider scope={{ kind: "user-wide" }}>
      <PinContextProvider>
        <CompanionHotkeyBridge />
        <Wallpaper />
        <PaneCompanionRow>{children}</PaneCompanionRow>
        <Dock />
        <OverlayHost />
      </PinContextProvider>
    </ScopeProvider>
  );
}
