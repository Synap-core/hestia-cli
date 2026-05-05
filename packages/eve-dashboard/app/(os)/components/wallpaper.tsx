"use client";

/**
 * `Wallpaper` — Layer 1 of the Eve OS shell.
 *
 * A fixed, full-viewport mesh-gradient surface that lives behind every
 * app pane. Three soft radial blobs drift over a near-black base in
 * dark mode (or near-white pastel in light mode) on slow opposing
 * cycles. A faint SVG noise overlay adds texture without adding any
 * asset weight.
 *
 * Animation is `transform`-only (GPU friendly). `prefers-reduced-motion`
 * pauses the loops and leaves the blobs in a calm, intentional pose.
 *
 * The wallpaper renders ONCE in the OS layout and never unmounts during
 * route changes — it is the persistent background of the whole OS.
 *
 * See: synap-team-docs/content/team/platform/eve-os-shell.mdx §3
 */

export function Wallpaper() {
  return (
    <div className="os-wallpaper" aria-hidden>
      <div className="os-blob os-blob-a animate-wallpaper-drift-a" />
      <div className="os-blob os-blob-b animate-wallpaper-drift-b" />
      <div className="os-blob os-blob-c animate-wallpaper-drift-c" />
      <div className="os-grain" />
    </div>
  );
}
