/**
 * `SkeletonTile` — pulsing placeholder shown while the marketplace
 * fetch is in flight. Same dimensions as `<AppTile />` so the grid
 * doesn't shift when real tiles fade in.
 */

export function SkeletonTile() {
  return (
    <div
      role="presentation"
      aria-hidden
      className="
        aspect-square w-full
        rounded-tile border border-divider bg-content1/70
        tile-pulse
      "
    />
  );
}
