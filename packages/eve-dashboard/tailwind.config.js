const { heroui } = require("@heroui/react");

/**
 * Eve dashboard theme — warm, sovereign, calm.
 *
 * Light mode: warm off-white surfaces, oak borders, deep ink text.
 * Dark mode:  near-black with a faint green tint, low-contrast surfaces,
 *             bright emerald accent for life.
 *
 * Type system: Fraunces (display/headings, optical-size) + DM Sans (body)
 *              + Geist Mono (keys, container names, CLI snippets).
 *
 * No shadows anywhere — depth is built from 1px borders + small surface lifts.
 */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    // @heroui/theme bundles all the tailwind-variants strings for every
    // component — symlinked locally because we depend on it directly.
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx,mjs}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "DM Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "Fraunces", "Georgia", "serif"],
        mono: ["var(--font-mono)", "Geist Mono", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.025em",
      },
      backgroundImage: {
        "eve-glow":
          "radial-gradient(60% 60% at 50% 0%, rgba(16,185,129,0.08) 0%, transparent 70%)",
        "ai-gradient":
          "linear-gradient(135deg, #10B981 0%, #34D399 50%, #6EE7B7 100%)",
      },
      // ----------------------------------------------------------------------
      // OS Home tokens (eve-os-home-design.mdx §6 + eve-os-shell.mdx §7).
      //
      // HeroUI already exposes `primary.*` (emerald) as the AI accent — these
      // additions give the OS Home page semantic aliases so status dots and
      // tile tints use names that match the design spec.
      // ----------------------------------------------------------------------
      colors: {
        ai: {
          from: "#10B981",
          via:  "#34D399",
          to:   "#6EE7B7",
        },
        status: {
          online:   "#34D399",
          degraded: "#FBBF24",
          offline:  "#94A3B8",
        },
        // OS shell — wallpaper base and translucent surface tints.
        os: {
          base:            "#0A0A14",                         // dark wallpaper base
          baseLight:       "#F5F4FA",                         // light wallpaper base
          paneBg:          "rgba(20, 20, 28, 0.55)",
          paneBgLight:     "rgba(255, 255, 255, 0.65)",
          paneBorder:      "rgba(255, 255, 255, 0.08)",
          paneBorderLight: "rgba(0, 0, 0, 0.06)",
          dockBg:          "rgba(20, 20, 28, 0.50)",
          dockBgLight:     "rgba(255, 255, 255, 0.55)",
        },
        // Per-app brand colors used by dock icons + Home grid.
        brand: {
          home:     "#A78BFA",
          agents:   "#34D399",
          settings: "#94A3B8",
          chat:     "#10B981",
          synap:    "#34D399",
        },
      },
      backdropBlur: {
        pane: "40px",
        dock: "48px",
      },
      borderRadius: {
        tile: "20px",
        pane: "24px",
        dock: "32px",
        icon: "12px",
      },
      keyframes: {
        // Wallpaper drift — opposing slow loops on translate3d only, GPU-friendly.
        "wallpaper-drift-a": {
          "0%, 100%": { transform: "translate3d(-10%, -8%, 0) scale(1)" },
          "50%":      { transform: "translate3d(8%, 6%, 0) scale(1.05)" },
        },
        "wallpaper-drift-b": {
          "0%, 100%": { transform: "translate3d(8%, 10%, 0) scale(1.04)" },
          "50%":      { transform: "translate3d(-6%, -8%, 0) scale(0.98)" },
        },
        "wallpaper-drift-c": {
          "0%, 100%": { transform: "translate3d(0%, 0%, 0) rotate(0deg)" },
          "50%":      { transform: "translate3d(-4%, 6%, 0) rotate(8deg)" },
        },
        // Pane content cross-fade on route swap.
        "pane-content-in": {
          "0%":   { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Newly resolved icon fade-in (Home).
        "icon-fade-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        // Newly installed icon — overshoot pop.
        "icon-pop-in": {
          "0%":   { opacity: "0", transform: "scale(0.85)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        // Stat / icon skeleton shimmer.
        "shimmer-pulse": {
          "0%, 100%": { opacity: "0.6" },
          "50%":      { opacity: "1" },
        },
      },
      animation: {
        "wallpaper-drift-a": "wallpaper-drift-a 72s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "wallpaper-drift-b": "wallpaper-drift-b 90s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "wallpaper-drift-c": "wallpaper-drift-c 60s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "pane-content-in":   "pane-content-in 140ms ease-out",
        "icon-fade-in":      "icon-fade-in 140ms ease-out",
        "icon-pop-in":       "icon-pop-in 240ms cubic-bezier(0.16, 1, 0.3, 1)",
        "shimmer-pulse":     "shimmer-pulse 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [
    heroui({
      defaultTheme: "dark",
      defaultExtendTheme: "dark",
      layout: {
        radius: {
          small: "8px",
          medium: "10px",
          large: "14px",
        },
        borderWidth: {
          small: "1px",
          medium: "1px",
          large: "1px",
        },
      },
      themes: {
        // ---------------------------------------------------------------
        // LIGHT — warm off-white, deep ink
        // ---------------------------------------------------------------
        light: {
          colors: {
            background: "#FAF9F6",     // page
            foreground: "#1A1A19",     // body text
            divider:    "#E5E2DA",     // hairlines
            focus:      "#10B981",
            content1: "#FFFFFF",       // cards / surface 1
            content2: "#F4F2EE",       // sunken / inputs / code chips
            content3: "#ECEAE3",
            content4: "#E0DCD2",
            default: {
              50:  "#FAF9F6",
              100: "#F4F2EE",
              200: "#ECEAE3",
              300: "#D9D5C9",
              400: "#A8A49A",
              500: "#6B6963",
              600: "#4A4844",
              700: "#2F2E2B",
              800: "#1F1F1D",
              900: "#1A1A19",
              DEFAULT:    "#F4F2EE",
              foreground: "#1A1A19",
            },
            primary: {
              50:  "#ECFDF5",
              100: "#D1FAE5",
              200: "#A7F3D0",
              300: "#6EE7B7",
              400: "#34D399",
              500: "#10B981",
              600: "#059669",
              700: "#047857",
              800: "#065F46",
              900: "#064E3B",
              DEFAULT:    "#10B981",
              foreground: "#FFFFFF",
            },
            success: { DEFAULT: "#10B981", foreground: "#FFFFFF" },
            warning: { DEFAULT: "#D97706", foreground: "#FFFFFF" },
            danger:  { DEFAULT: "#DC2626", foreground: "#FFFFFF" },
          },
        },

        // ---------------------------------------------------------------
        // DARK — near-black with a hint of green, low-contrast surfaces
        // ---------------------------------------------------------------
        dark: {
          colors: {
            background: "#0B0C0A",
            foreground: "#ECECEA",
            divider:    "#23262B",
            focus:      "#34D399",
            content1: "#15171A",
            content2: "#1B1E22",
            content3: "#22262B",
            content4: "#2A2E34",
            default: {
              50:  "#15171A",
              100: "#1B1E22",
              200: "#22262B",
              300: "#2A2E34",
              400: "#5C6068",
              500: "#8B8B85",
              600: "#A8A8A2",
              700: "#C9C9C4",
              800: "#DEDEDA",
              900: "#ECECEA",
              DEFAULT:    "#1B1E22",
              foreground: "#ECECEA",
            },
            primary: {
              50:  "#052E22",
              100: "#064E3B",
              200: "#065F46",
              300: "#047857",
              400: "#059669",
              500: "#10B981",
              600: "#34D399",
              700: "#6EE7B7",
              800: "#A7F3D0",
              900: "#D1FAE5",
              DEFAULT:    "#34D399",
              foreground: "#062418",
            },
            success: { DEFAULT: "#34D399", foreground: "#062418" },
            warning: { DEFAULT: "#F59E0B", foreground: "#1A1304" },
            danger:  { DEFAULT: "#F87171", foreground: "#2A0A0A" },
          },
        },
      },
    }),
  ],
};
