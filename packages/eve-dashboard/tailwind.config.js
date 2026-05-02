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
