"use client";

import { useCompanionHotkeys } from "../hooks/use-companion-hotkeys";

/** Mounts the global Cmd+L / Ctrl+L companion hotkey. Renders nothing. */
export function CompanionHotkeyBridge() {
  useCompanionHotkeys();
  return null;
}
