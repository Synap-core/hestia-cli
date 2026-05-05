/**
 * Per-app brand-color registry.
 *
 * The dock and the Home grid both render an app's icon as a vivid
 * colored rounded square. Both surfaces read from this map so adding a
 * new entry here re-skins the app on every surface in one shot.
 *
 * The `glyph` field is a Lucide icon name. When `null`, the renderer
 * falls back to the app's `iconUrl` (remote SVG/PNG from the
 * marketplace) over the same brand-colored background.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §11
 */

export interface BrandColor {
  /** CSS background — solid color or gradient string. */
  bg: string;
  /** Lucide icon name. `null` ⇒ caller should render the remote `iconUrl`. */
  glyph: string | null;
  /** Solid color used for dock active indicator + icon hover/glow ring. */
  accent: string;
}

export const BRAND_COLORS: Record<string, BrandColor> = {
  // ── Core / pinned ────────────────────────────────────────────────────────
  home:        { bg: "linear-gradient(135deg, #A78BFA, #818CF8)", glyph: "Home",          accent: "#A78BFA" },
  agents:      { bg: "#34D399",                                    glyph: "Sparkles",      accent: "#34D399" },
  settings:    { bg: "#475569",                                    glyph: "Settings",      accent: "#94A3B8" },

  // ── Eve components ──────────────────────────────────────────────────────
  openwebui:   { bg: "linear-gradient(135deg, #10B981, #34D399)", glyph: "MessageSquare", accent: "#10B981" },
  chat:        { bg: "linear-gradient(135deg, #10B981, #34D399)", glyph: "MessageSquare", accent: "#10B981" },
  synap:       { bg: "#34D399",                                    glyph: "Brain",         accent: "#34D399" },
  openclaw:    { bg: "linear-gradient(135deg, #6366F1, #8B5CF6)", glyph: "Paperclip",     accent: "#818CF8" },
  hermes:      { bg: "linear-gradient(135deg, #F59E0B, #F97316)", glyph: "Wrench",        accent: "#FBBF24" },
  "dev-agent": { bg: "linear-gradient(135deg, #4F46E5, #7C3AED)", glyph: "Code2",         accent: "#6366F1" },

  // ── Marketplace classics ────────────────────────────────────────────────
  "the-arch":  { bg: "#5B21B6",                                    glyph: null,            accent: "#7C3AED" },
  arch:        { bg: "#5B21B6",                                    glyph: null,            accent: "#7C3AED" },
  crm:         { bg: "#E11D48",                                    glyph: "Users",         accent: "#F43F5E" },
  devplane:    { bg: "#F59E0B",                                    glyph: "LayoutGrid",    accent: "#FBBF24" },
};

/**
 * Stable hash → 0–359 hue, used by the deterministic fallback so
 * unregistered apps still feel intentional on first install.
 */
function hashToHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

/**
 * Deterministic palette for unregistered apps. Hue-rotates a saturated
 * mid-tone by a slug hash; glyph stays `null` so the remote `iconUrl`
 * (or a generic fallback) renders.
 */
export function fallbackBrandColor(slug: string): BrandColor {
  const hue = hashToHue(slug);
  return {
    bg: `hsl(${hue}, 65%, 50%)`,
    glyph: null,
    accent: `hsl(${hue}, 65%, 60%)`,
  };
}

export function brandColorFor(slug: string): BrandColor {
  return BRAND_COLORS[slug] ?? fallbackBrandColor(slug);
}
