import type { ChipColor } from "./types";

// Tailwind needs full class strings at build time — we keep a static map and
// look up by ChipColor. Every entry is a tuned dark-mode-friendly set.
export interface ChipClasses {
  /** Background tint (low opacity). */
  bg: string;
  /** Text color (mid brightness). */
  text: string;
  /** Border tint (low opacity). */
  border: string;
  /** Solid color for indicators/dots. */
  dot: string;
  /** Combined ring for focused / selected state. */
  ring: string;
}

export const CHIP_COLOR_CLASSES: Record<ChipColor, ChipClasses> = {
  slate: {
    bg: "bg-slate-500/10",
    text: "text-slate-300",
    border: "border-slate-500/20",
    dot: "bg-slate-400",
    ring: "ring-slate-500/30",
  },
  neutral: {
    bg: "bg-foreground/5",
    text: "text-foreground/60",
    border: "border-foreground/15",
    dot: "bg-foreground/40",
    ring: "ring-foreground/20",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/30",
  },
  amber: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
    dot: "bg-amber-500",
    ring: "ring-amber-500/30",
  },
  rose: {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/20",
    dot: "bg-rose-500",
    ring: "ring-rose-500/30",
  },
  violet: {
    bg: "bg-violet-500/10",
    text: "text-violet-400",
    border: "border-violet-500/20",
    dot: "bg-violet-500",
    ring: "ring-violet-500/30",
  },
  sky: {
    bg: "bg-sky-500/10",
    text: "text-sky-400",
    border: "border-sky-500/20",
    dot: "bg-sky-500",
    ring: "ring-sky-500/30",
  },
  blue: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
    dot: "bg-blue-500",
    ring: "ring-blue-500/30",
  },
  indigo: {
    bg: "bg-indigo-500/10",
    text: "text-indigo-400",
    border: "border-indigo-500/20",
    dot: "bg-indigo-500",
    ring: "ring-indigo-500/30",
  },
  fuchsia: {
    bg: "bg-fuchsia-500/10",
    text: "text-fuchsia-400",
    border: "border-fuchsia-500/20",
    dot: "bg-fuchsia-500",
    ring: "ring-fuchsia-500/30",
  },
  teal: {
    bg: "bg-teal-500/10",
    text: "text-teal-400",
    border: "border-teal-500/20",
    dot: "bg-teal-500",
    ring: "ring-teal-500/30",
  },
  cyan: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    border: "border-cyan-500/20",
    dot: "bg-cyan-500",
    ring: "ring-cyan-500/30",
  },
};

export function getChipClasses(color: ChipColor | undefined): ChipClasses {
  return CHIP_COLOR_CLASSES[color ?? "neutral"];
}
