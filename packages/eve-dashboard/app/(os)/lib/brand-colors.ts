/**
 * Per-app brand-color registry — visionOS material recipe.
 *
 * Each entry supplies a gentle 2-stop gradient (light→mid). Combined
 * with the `.glass-icon` class in globals.css (1px white inner ring +
 * single top-edge highlight), the result feels like a translucent
 * spatial app icon, not a skeuomorphic decal.
 *
 * Why 2-stop, not 3-stop: visionOS surfaces don't darken at the base.
 * The wallpaper bleeds through; depth comes from material layering.
 *
 * `glyph` is a Lucide icon name. When `null`, the renderer falls back
 * to the app's `iconUrl` over the same gradient.
 *
 * See: synap-team-docs/content/team/platform/eve-os-home-design.mdx §11
 *      synap-team-docs/content/team/platform/eve-os-shell.mdx §5
 */

export interface BrandColor {
  /** CSS background — vertical 2-stop gradient. */
  bg: string;
  /** Lucide icon name. `null` ⇒ caller should render the remote `iconUrl`. */
  glyph: string | null;
  /** Solid color used for dock active indicator + icon hover/glow ring. */
  accent: string;
}

/** 2-stop top→mid linear gradient — matches the visionOS app-icon feel. */
function vGrad(top: string, mid: string): string {
  return `linear-gradient(180deg, ${top} 0%, ${mid} 100%)`;
}

export const BRAND_COLORS: Record<string, BrandColor> = {
  // ── Core / pinned ────────────────────────────────────────────────────────
  home:        { bg: vGrad("#A78BFA", "#7C3AED"), glyph: "Home",          accent: "#A78BFA" },
  agents:      { bg: vGrad("#34D399", "#10B981"), glyph: "Sparkles",      accent: "#34D399" },
  settings:    { bg: vGrad("#94A3B8", "#475569"), glyph: "Settings",      accent: "#94A3B8" },

  // ── Eve components ──────────────────────────────────────────────────────
  openwebui:   { bg: vGrad("#34D399", "#059669"), glyph: "MessageSquare", accent: "#10B981" },
  chat:        { bg: vGrad("#34D399", "#059669"), glyph: "MessageSquare", accent: "#10B981" },
  synap:       { bg: vGrad("#6EE7B7", "#10B981"), glyph: "Brain",         accent: "#34D399" },
  openclaw:    { bg: vGrad("#A78BFA", "#7C3AED"), glyph: "Paperclip",     accent: "#A78BFA" },
  hermes:      { bg: vGrad("#FBBF24", "#D97706"), glyph: "Wrench",        accent: "#FBBF24" },
  "dev-agent": { bg: vGrad("#818CF8", "#4F46E5"), glyph: "Code2",         accent: "#818CF8" },
  ollama:      { bg: vGrad("#94A3B8", "#475569"), glyph: "Cpu",           accent: "#94A3B8" },
  rsshub:      { bg: vGrad("#FB923C", "#EA580C"), glyph: "Rss",           accent: "#FB923C" },

  // ── Marketplace classics ────────────────────────────────────────────────
  "the-arch":  { bg: vGrad("#A855F7", "#6D28D9"), glyph: null,            accent: "#A855F7" },
  arch:        { bg: vGrad("#A855F7", "#6D28D9"), glyph: null,            accent: "#A855F7" },
  crm:         { bg: vGrad("#FB7185", "#E11D48"), glyph: "Users",         accent: "#FB7185" },
  devplane:    { bg: vGrad("#FCD34D", "#D97706"), glyph: "LayoutGrid",    accent: "#FBBF24" },
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
 * Deterministic palette for unregistered apps. Hue-rotates by slug hash;
 * always emits a 2-stop gradient.
 */
export function fallbackBrandColor(slug: string): BrandColor {
  const hue = hashToHue(slug);
  return {
    bg: vGrad(`hsl(${hue}, 70%, 60%)`, `hsl(${hue}, 65%, 42%)`),
    glyph: null,
    accent: `hsl(${hue}, 65%, 55%)`,
  };
}

export function brandColorFor(slug: string): BrandColor {
  return BRAND_COLORS[slug] ?? fallbackBrandColor(slug);
}
