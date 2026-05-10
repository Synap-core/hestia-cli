"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { Check, Copy, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { AppPane } from "../../components/app-pane";
import { PaneHeader } from "../../components/pane-header";

interface EmbeddedExternalAppPageProps {
  appId: string;
  name?: string;
  url?: string;
  sendAuth?: boolean;
  /** When provided, a copy-link button is shown that copies this URL to the clipboard. */
  shareUrl?: string;
}

export function EmbeddedExternalAppPage({
  appId,
  name,
  url,
  sendAuth,
  shareUrl,
}: EmbeddedExternalAppPageProps) {
  const router = useRouter();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const title = name?.trim() || appId;

  const handleCopyLink = useCallback(() => {
    if (!shareUrl) return;
    const full = `${window.location.origin}${shareUrl}`;
    void navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [shareUrl]);

  if (!url) {
    return (
      <>
        <PaneHeader title={title} back={() => router.push("/")} />
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-foreground/55">This app does not have a launch URL.</p>
        </div>
      </>
    );
  }

  const content = (
    <>
      <PaneHeader
        title={title}
        back={() => router.push("/")}
        actions={
          <>
            {shareUrl && (
              <Button
                isIconOnly
                variant="light"
                size="sm"
                radius="full"
                aria-label={copied ? "Link copied" : "Copy share link"}
                onPress={handleCopyLink}
                className="text-foreground/55 hover:text-foreground"
              >
                {copied ? (
                  <Check className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={2} />
                )}
              </Button>
            )}
            <Button
              isIconOnly
              variant="light"
              size="sm"
              radius="full"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              onPress={() => setIsFullscreen((value) => !value)}
              className="text-foreground/55 hover:text-foreground"
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Maximize2 className="h-4 w-4" strokeWidth={2} />
              )}
            </Button>
            <Button
              isIconOnly
              variant="light"
              size="sm"
              radius="full"
              aria-label="Open in new tab"
              onPress={() => window.open(url, "_blank", "noopener,noreferrer")}
              className="text-foreground/55 hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={2} />
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1">
        <AppPane appId={appId} url={url} sendAuth={sendAuth === true} />
      </div>
    </>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        {content}
      </div>
    );
  }

  return content;
}
