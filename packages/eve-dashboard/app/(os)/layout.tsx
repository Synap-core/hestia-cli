/**
 * Eve OS shell layout — composes the three layers every app inherits:
 *
 *   1. Wallpaper — fixed animated mesh-gradient (z-0)
 *   2. Pane      — frosted popup that holds the active app (z-10)
 *   3. Dock      — bottom pill app launcher (z-20)
 *
 * Routes outside this group (`/login`, `/auth/callback`) deliberately
 * skip the shell — they predate it and need their own chrome.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §6
 */

import type { ReactNode } from "react";
import { Wallpaper } from "./components/wallpaper";
import { Pane } from "./components/pane";
import { Dock } from "./components/dock";

export default function OSLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Wallpaper />
      <Pane>{children}</Pane>
      <Dock />
    </>
  );
}
