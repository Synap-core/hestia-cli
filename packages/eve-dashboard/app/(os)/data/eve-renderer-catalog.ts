/**
 * Catalog of renderers Eve OS knows how to mount.
 *
 * Pure data — the Renderer Picker reads from here to populate its menu.
 * The Picker writes selections into `workspaces.settings.profileRenderers`
 * via the backend, then the resolver picks them up on next round-trip.
 *
 * Adding a new renderer = one entry here + the matching component file
 * + an entry in the page's `EVE_*_RENDERERS` map. No backend changes.
 *
 * Catalog vs map:
 * - Catalog (this file) is the *picker menu* — what's offerable to users.
 * - `EVE_DETAIL_RENDERERS` / `EVE_LIST_RENDERERS` are *dispatch tables* —
 *   what actually mounts when a resolver returns a given cellKey.
 *
 * They diverge intentionally: an alias cellKey ('form' → entity-detail)
 * can exist in the dispatch table without showing up in the picker.
 */

import type { ProfileRendererSlot } from "@eve/profile-renderer";

export interface RendererOption {
  /** The cellKey written into RendererRef when selected. */
  cellKey: string;
  /** Human-readable name shown in the picker. */
  displayName: string;
  /** Short blurb under the name. */
  description?: string;
}

export const EVE_RENDERER_CATALOG: Record<
  ProfileRendererSlot,
  RendererOption[]
> = {
  list: [
    {
      cellKey: "list",
      displayName: "List",
      description: "Card-style stack of entities (default fallback).",
    },
    {
      cellKey: "table",
      displayName: "Table",
      description: "Data table with auto-detected columns.",
    },
  ],
  detail: [
    {
      cellKey: "entity-detail",
      displayName: "Form",
      description:
        "HeroField-based form with hero header, description, and properties.",
    },
  ],
};
