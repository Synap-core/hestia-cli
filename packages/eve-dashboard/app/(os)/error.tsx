"use client";

/**
 * Eve OS — route-segment error boundary.
 *
 * Next.js App Router calls this component when a render error escapes
 * any page or nested layout under `(os)/*`. Without it, an unhandled
 * exception blanks the whole pane and the dock — a worse failure mode
 * than the original bug. With it, the pane stays mounted and the user
 * gets a calm recovery card with "Try again" (calls `reset()` which
 * re-renders the segment) and a "Report" affordance that copies the
 * full error context to the clipboard.
 *
 * Scope:
 *   • Catches client-side render errors.
 *   • Does NOT catch errors thrown inside event handlers or async
 *     callbacks — those still need local try/catch + toast.
 *   • Does NOT catch errors in the root `app/layout.tsx`; use
 *     `app/global-error.tsx` for that (see Next docs).
 *
 * Reporting:
 *   The `digest` field is Next's stable error id (server-stripped
 *   stack in prod). We surface it alongside the message so users can
 *   give us something searchable when they ping support. The "Copy
 *   diagnostics" button assembles a one-shot dump of message + digest
 *   + pathname + UA — paste-ready for the dev channel.
 *
 * UX rules (per project memory):
 *   • HeroUI primitives (Card, Button, addToast).
 *   • `text-foreground/N` opacity tiers — never `text-default-X`.
 *   • Concentric radii: pane (32) → body (20) → inset (12).
 *   • No drop shadows; ring-1 inset for material depth.
 */

import { useEffect } from "react";
import { Button, Card, addToast } from "@heroui/react";
import { AlertOctagon, Copy, Home, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

interface RouteError extends Error {
  /** Next.js prod-build error id; correlates with server logs. */
  digest?: string;
}

export default function OSSegmentError({
  error,
  reset,
}: {
  error: RouteError;
  reset: () => void;
}) {
  const router = useRouter();

  // Console log every error that lands here — `digest` is the only
  // bridge between the user-visible card and the server log line.
  useEffect(() => {
    console.error("[eve:os-error]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  const handleCopy = async () => {
    const payload = formatDiagnostics(error);
    try {
      await navigator.clipboard.writeText(payload);
      addToast({ title: "Diagnostics copied", color: "success" });
    } catch {
      addToast({
        title: "Couldn’t copy",
        description: "Clipboard access was denied.",
        color: "warning",
      });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-12">
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
              This view crashed
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-snug text-foreground/65">
              Something went wrong rendering this screen. The rest of Eve is
              still running — you can retry, head home, or share diagnostics
              with the team.
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
          {error.message || "Unknown render error"}
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
            onPress={reset}
          >
            Try again
          </Button>
        </div>
      </Card>
    </div>
  );
}

function formatDiagnostics(error: RouteError): string {
  const lines = [
    "Eve OS render error",
    "───────────────────",
    `Message: ${error.message || "(none)"}`,
    error.digest ? `Digest:  ${error.digest}` : null,
    typeof window !== "undefined" ? `Path:    ${window.location.pathname}` : null,
    typeof window !== "undefined" ? `URL:     ${window.location.href}` : null,
    typeof navigator !== "undefined" ? `UA:      ${navigator.userAgent}` : null,
    `Time:    ${new Date().toISOString()}`,
    "",
    "Stack:",
    error.stack ?? "(stripped in production)",
  ];
  return lines.filter((l) => l !== null).join("\n");
}
