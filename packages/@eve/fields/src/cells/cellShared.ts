import type { HeroFieldSize, HeroFieldVariant } from "../types";

/**
 * Shared typography classes so the read element (button/text) and the write
 * element (input/select trigger) share identical metrics — no size jump
 * during the read↔write transition.
 */
export function getValueTypography(
  size: HeroFieldSize,
  variant: HeroFieldVariant,
): string {
  if (variant === "card") {
    return size === "lg"
      ? "text-base sm:text-[15px]"
      : size === "sm"
        ? "text-[13px]"
        : "text-[14px] sm:text-[15px]";
  }
  // inline + row both use text-sm scale
  return size === "lg" ? "text-[15px]" : size === "sm" ? "text-[12px]" : "text-sm";
}

export function getValueColor(hasValue: boolean): string {
  return hasValue ? "text-foreground/85" : "text-foreground/35 italic";
}

/** Min-height keeps the value row from collapsing when empty. */
export function getValueMinHeight(size: HeroFieldSize): string {
  return size === "lg" ? "min-h-[1.5rem]" : size === "sm" ? "min-h-[1.125rem]" : "min-h-[1.25rem]";
}
