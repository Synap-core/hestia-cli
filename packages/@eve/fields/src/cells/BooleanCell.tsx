"use client";
import { Switch } from "@heroui/react";

import type { HeroFieldSize, HeroFieldVariant } from "../types";

interface Props {
  value: boolean | undefined;
  onChange?: (v: boolean) => void;
  /** "switch" = HeroUI Switch (default). "checkbox" = inline label + check. */
  appearance?: "switch" | "checkbox";
  /** Trailing label shown next to the switch (e.g. "Active"). */
  trueLabel?: string;
  falseLabel?: string;
  size?: HeroFieldSize;
  variant?: HeroFieldVariant;
}

const SWITCH_SIZE: Record<HeroFieldSize, "sm" | "md" | "lg"> = {
  sm: "sm",
  md: "sm",
  lg: "md",
};

/**
 * Boolean cell — always rendered as an interactive widget (no read/write
 * swap). Switch is the default; pass `appearance="checkbox"` for compact
 * yes/no fields. HeroUI Switch picks up the app's primary color natively.
 */
export function BooleanCell({
  value,
  onChange,
  appearance: _appearance = "switch",
  trueLabel,
  falseLabel,
  size = "md",
  variant: _variant = "inline",
}: Props) {
  const readOnly = !onChange;
  const checked = Boolean(value);
  const label = checked ? trueLabel : falseLabel;

  return (
    <div className="flex items-center gap-2">
      <Switch
        size={SWITCH_SIZE[size]}
        isSelected={checked}
        isDisabled={readOnly}
        onValueChange={(next) => onChange?.(next)}
        aria-label={label ?? (checked ? "On" : "Off")}
      />
      {label ? (
        <span
          className={[
            "text-[13px]",
            checked ? "text-foreground" : "text-default-500",
          ].join(" ")}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
