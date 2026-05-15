/**
 * `app/(os)/loading.tsx` — Loading state for the OS shell route group.
 *
 * Shown while Next.js is loading the initial server render or
 * transitioning between routes inside the (os) layout group.
 * Keeps the wallpaper + dock visible so the OS feel is maintained.
 *
 * The animation mirrors the `pane-content-in` keyframe and uses
 * the same glass-morphic card style as the rest of the OS.
 */

import { Spinner } from "@heroui/react";
import { Sparkles } from "lucide-react";

export default function OSLoadding() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 pb-20 pt-8">
      <div
        className="
          flex h-14 w-14 items-center justify-center rounded-2xl
          bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10
        "
      >
        <Sparkles
          className="h-5 w-5 shrink-0 text-primary"
          strokeWidth={1.8}
        />
      </div>
      <Spinner
        size="sm"
        classNames={{
          wrapper: "mt-2",
          circle1: "text-primary/60",
          circle2: "text-primary/40",
        }}
      />
      <p className="text-[12px] text-foreground/40 animate-pulse">
        Loading your workspace…
      </p>
    </div>
  );
}