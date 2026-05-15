/**
 * `app/global-error.tsx` — Root-level error boundary.
 *
 * Catches errors that escape the entire React tree (layout errors,
 * hydration failures, etc.). Without this, a root error blanks the
 * whole page — with it, we show a calm recovery UI.
 *
 * See: error.tsx in (os) for segment-level errors.
 */

"use client";

import { useEffect } from "react";
import { Button, Card, addToast } from "@heroui/react";
import { AlertOctagon, Copy, Home, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("[eve:global-error]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  const handleCopy = async () => {
    const payload = [
      "Eve Global Error",
      "────────────────",
      `Message: ${error.message || "(none)"}`,
      error.digest ? `Digest:  ${error.digest}` : null,
      `URL:     ${typeof window !== "undefined" ? window.location.href : "n/a"}`,
      `UA:      ${typeof navigator !== "undefined" ? navigator.userAgent : "n/a"}`,
      `Time:    ${new Date().toISOString()}`,
      "",
      error.stack ?? "(stripped in production)",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(payload);
      addToast({ title: "Diagnostics copied", color: "success" });
    } catch {
      addToast({
        title: "Couldn't copy",
        description: "Clipboard access was denied.",
        color: "warning",
      });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card
        radius="lg"
        shadow="none"
        className="
          flex w-full max-w-lg flex-col gap-4 p-6
          bg-foreground/[0.04]
          ring-1 ring-inset ring-foreground/10
        "
      >
        <div className="flex items-start gap-3">
          <span
            className="
              flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
              bg-danger/15 text-danger
              ring-1 ring-inset ring-danger/30
            "
            aria-hidden
          >
            <AlertOctagon className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-medium text-foreground">
              Something went wrong
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-snug text-foreground/65">
              A critical error occurred. The page will not render correctly.
              You can try reloading or return to the home page.
            </p>
          </div>
        </div>

        <pre
          className="
            max-h-40 overflow-auto rounded-lg
            bg-foreground/[0.05]
            ring-1 ring-inset ring-foreground/10
            px-3 py-2
            text-[11px] leading-snug text-foreground/75
            font-mono whitespace-pre-wrap break-words
          "
        >
          {error.message || "Unknown error"}
          {error.digest ? `\n\nDigest: ${error.digest}` : ""}
        </pre>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            radius="full"
            variant="light"
            startContent={<Copy className="h-3.5 w-3.5" />}
            onPress={handleCopy}
          >
            Copy diagnostics
          </Button>
          <Button
            size="sm"
            radius="full"
            variant="flat"
            startContent={<Home className="h-3.5 w-3.5" />}
            onPress={() => router.push("/")}
          >
            Go home
          </Button>
          <Button
            size="sm"
            radius="full"
            color="primary"
            variant="solid"
            startContent={<RotateCcw className="h-3.5 w-3.5" />}
            onPress={() => {
              // Hard reload to clear any stale state
              window.location.reload();
            }}
          >
            Reload page
          </Button>
        </div>
      </Card>
    </div>
  );
}