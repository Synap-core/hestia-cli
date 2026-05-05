/**
 * Per-app brand-color registry — premium 2.5D recipe.
 *
 * Each entry supplies a vertical gradient (light at the top → mid →
 * dark at the bottom) that, combined with the `.app-icon-25d` class
 * in globals.css, produces a pressed-glass tile. The shell never
 * applies a flat color — every icon is rendered as a 3D form.
 *
 * The dock and the Home grid both read this map so adding a new entry
 * here re-skins the app on every surface in one shot.
 *
 * `glyph` is a Lucide icon name. When `null`, the renderer falls back
 * to the app's `iconUrl` (remote SVG/PNG) over the same gradient.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §11
 *      synap-team-docs/content/team/platform/eve-os-shell.mdx §5
 */

export interface BrandColor {
  /** CSS background — always a vertical 3-stop gradient for the 2.5D recipe. */
  bg: string;
  /** Lucide icon name. `null` ⇒ caller should render the remote `iconUrl`. */
  glyph: string | null;
  /** Solid color used for dock active indicator + icon hover/glow ring. */
  accent: string;
}

/** Helper — builds a top-to-bottom 3-stop gradient from a brand triplet. */
function vGrad(top: string, mid: string, bottom: string): string {
  return `linear-gradient(180deg, ${top} 0%, ${mid} 50%, ${bottom} 100%)`;
}

export const BRAND_COLORS: Record<string, BrandColor> = {
  // ── Core / pinned ────────────────────────────────────────────────────────
  home:        { bg: vGrad("#C4B5FD", "#A78BFA", "#7C3AED"), glyph: "Home",          accent: "#A78BFA" },
  agents:      { bg: vGrad("#6EE7B7", "#34D399", "#0EA371"), glyph: "Sparkles",      accent: "#34D399" },
  settings:    { bg: vGrad("#94A3B8", "#64748B", "#334155"), glyph: "Settings",      accent: "#94A3B8" },

  // ── Eve components ──────────────────────────────────────────────────────
  openwebui:   { bg: vGrad("#34D399", "#10B981", "#047857"), glyph: "MessageSquare", accent: "#10B981" },
  chat:        { bg: vGrad("#34D399", "#10B981", "#047857"), glyph: "MessageSquare", accent: "#10B981" },
  synap:       { bg: vGrad("#6EE7B7", "#10B981", "#065F46"), glyph: "Brain",         accent: "#34D399" },
  openclaw:    { bg: vGrad("#A78BFA", "#7C3AED", "#4C1D95"), glyph: "Paperclip",     accent: "#A78BFA" },
  hermes:      { bg: vGrad("#FBBF24", "#F59E0B", "#B45309"), glyph: "Wrench",        accent: "#FBBF24" },
  "dev-agent": { bg: vGrad("#818CF8", "#6366F1", "#3730A3"), glyph: "Code2",         accent: "#818CF8" },
  ollama:      { bg: vGrad("#9CA3AF", "#6B7280", "#374151"), glyph: "Cpu",           accent: "#9CA3AF" },
  rsshub:      { bg: vGrad("#FB923C", "#F97316", "#9A3412"), glyph: "Rss",           accent: "#FB923C" },

  // ── Marketplace classics ────────────────────────────────────────────────
  "the-arch":  { bg: vGrad("#A855F7", "#7C3AED", "#4C1D95"), glyph: null,            accent: "#A855F7" },
  arch:        { bg: vGrad("#A855F7", "#7C3AED", "#4C1D95"), glyph: null,            accent: "#A855F7" },
  crm:         { bg: vGrad("#FB7185", "#F43F5E", "#9F1239"), glyph: "Users",         accent: "#FB7185" },
  devplane:    { bg: vGrad("#FCD34D", "#F59E0B", "#92400E"), glyph: "LayoutGrid",    accent: "#FBBF24" },
};

/** Stable hash → 0–359 hue. */
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
 * renders. Always emits a 3-stop gradient — never a flat color.
 */
export function fallbackBrandColor(slug: string): BrandColor {
  const hue = hashToHue(slug);
  return {
    bg: vGrad(
      `hsl(${hue}, 70%, 65%)`,
      `hsl(${hue}, 65%, 50%)`,
      `hsl(${hue}, 60%, 35%)`,
    ),
    glyph: null,
    accent: `hsl(${hue}, 65%, 55%)`,
  };
}

export function brandColorFor(slug: string): BrandColor {
  return BRAND_COLORS[slug] ?? fallbackBrandColor(slug);
}
