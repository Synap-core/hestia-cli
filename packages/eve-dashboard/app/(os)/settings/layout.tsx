/**
 * Settings layout — runs INSIDE the (os) shell pane.
 *
 * The shell already provides the wallpaper, the popup pane, and the
 * dock. Settings owns its own internal nav: a horizontal tab strip
 * directly under the pane header, then the active sub-page below.
 *
 * The legacy AppShell sidebar is gone. The work it used to do (group
 * settings under "Settings", surface theme toggle + sign out) lives
 * here as the Settings app's chrome. Sign-out moves to a discrete
 * action inside the General tab where it logically belongs.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §6 —
 *   "Settings as a popup app".
 */

import type { ReactNode } from "react";
import { SettingsTabs } from "./settings-tabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SettingsTabs />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="px-6 py-6">{children}</div>
      </div>
    </>
  );
}
