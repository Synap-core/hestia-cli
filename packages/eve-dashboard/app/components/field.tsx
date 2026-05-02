/**
 * Field — label + input pair.
 *
 * Why not HeroUI <Input>? Their `labelPlacement="outside"` mode silently
 * collapses the label slot when the inputWrapper is height-constrained or
 * the form is in certain disabled states, causing label/placeholder overlap.
 * A plain `<label>` + `<input>` is fully controllable and accessible.
 */

import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  hint?: string;
  error?: string;
  /** Icon shown on the left, inside the input border. */
  startIcon?: ReactNode;
  /** Icon (usually a button) shown on the right, inside the input border. */
  endIcon?: ReactNode;
  /** Render the typed value in monospace. Placeholder + label stay sans. */
  mono?: boolean;
}

export function Field({
  label,
  hint,
  error,
  startIcon,
  endIcon,
  mono,
  className = "",
  disabled,
  id,
  ...inputProps
}: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = hint || error ? `${inputId}-hint` : undefined;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-default-600"
      >
        {label}
      </label>
      <div
        className={
          "flex items-center gap-2 rounded-lg border bg-content2 px-3 transition-colors " +
          (disabled
            ? "border-divider opacity-60 cursor-not-allowed"
            : error
              ? "border-danger/60 focus-within:border-danger"
              : "border-divider focus-within:border-primary/60")
        }
      >
        {startIcon && (
          <span className="shrink-0 text-default-400">{startIcon}</span>
        )}
        <input
          id={inputId}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={hintId}
          spellCheck={false}
          autoComplete="off"
          className={
            "flex-1 min-w-0 bg-transparent border-0 outline-none py-2.5 text-sm text-foreground " +
            "placeholder:font-sans placeholder:text-default-400 " +
            "disabled:cursor-not-allowed " +
            (mono ? "font-mono tracking-tight" : "")
          }
          {...inputProps}
        />
        {endIcon && (
          <span className="shrink-0">{endIcon}</span>
        )}
      </div>
      {(hint || error) && (
        <p
          id={hintId}
          className={"text-xs " + (error ? "text-danger" : "text-default-400")}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
