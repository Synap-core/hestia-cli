/**
 * Eve wordmark — leaf icon + name.
 *
 * The leaf is hand-drawn (not lucide) so we control the exact silhouette and
 * the gradient that catches the eye on dark backgrounds. Two variants:
 * `full` shows leaf + name; `mark` is just the leaf.
 */

interface WordmarkProps {
  variant?: "full" | "mark";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE: Record<NonNullable<WordmarkProps["size"]>, { leaf: number; text: string }> = {
  sm: { leaf: 18, text: "text-base" },
  md: { leaf: 22, text: "text-lg" },
  lg: { leaf: 32, text: "text-2xl" },
};

export function Wordmark({ variant = "full", size = "md", className = "" }: WordmarkProps) {
  const { leaf, text } = SIZE[size];

  const mark = (
    <svg
      width={leaf}
      height={leaf}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="eve-leaf" x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>
      </defs>
      {/* Leaf body */}
      <path
        d="M4 20C4 11.7 10.7 5 19 5L20 5L20 6C20 14.3 13.3 21 5 21L4 21L4 20Z"
        fill="url(#eve-leaf)"
      />
      {/* Vein */}
      <path
        d="M4.5 20.5C8 17 11.5 13.5 19 6"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );

  if (variant === "mark") return <span className={className}>{mark}</span>;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {mark}
      <span className={`font-heading ${text} font-medium tracking-tightest text-foreground`}>
        Eve
      </span>
    </span>
  );
}
