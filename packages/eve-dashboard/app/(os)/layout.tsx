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

export default function OSLayout({ children }: { children: ReactNode }) {
  return (
    <PinContextProvider>
      <Wallpaper />
      <PaneCompanionRow>{children}</PaneCompanionRow>
      <Dock />
      <OverlayHost />
    </PinContextProvider>
  );
}
