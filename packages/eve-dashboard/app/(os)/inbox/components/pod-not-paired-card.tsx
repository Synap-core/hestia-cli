"use client";

/**
 * Empty state shown when the pod isn't paired (any `/api/hub/*` proxy
 * returned 503). The Inbox is purely a Hub Protocol consumer — without
 * a pod URL + API key on disk it has nothing to render.
 *
 * The CTA deep-links to `/settings` where the operator pairs the pod
 * (writes `~/.eve/secrets.json` `synap.{apiUrl, apiKey}`).
 */

import { Button, Card } from "@heroui/react";
import { Link as LinkIcon, ArrowRight } from "lucide-react";

export function PodNotPairedCard({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <Card
        radius="md"
        shadow="none"
        className="
          flex max-w-md flex-col items-center gap-4 px-8 py-10 text-center
          bg-foreground/[0.04]
          ring-1 ring-inset ring-foreground/10
        "
      >
        <span
          className="
            flex h-12 w-12 items-center justify-center
            rounded-xl
            bg-foreground/[0.06]
            ring-1 ring-inset ring-foreground/10
            text-foreground/70
          "
          aria-hidden
        >
          <LinkIcon className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[15px] font-medium text-foreground">
            Sign-in required
          </h2>
          <p className="max-w-xs text-[12.5px] leading-snug text-foreground/55">
            Pair this Eve with your Synap pod from Settings to see proposals,
            notifications, and the activity stream.
          </p>
        </div>
        <Button
          size="sm"
          radius="full"
          variant="flat"
          color="primary"
          endContent={<ArrowRight className="h-3.5 w-3.5" />}
          onPress={onOpenSettings}
          aria-label="Open Settings to sign in"
        >
          Open Settings
        </Button>
      </Card>
    </div>
  );
}
