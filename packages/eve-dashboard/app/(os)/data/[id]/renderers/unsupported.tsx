"use client";

/**
 * Placeholder shown when the resolved `RendererRef` references a renderer
 * Eve OS does not (yet) know how to mount. Honest about the gap rather than
 * silently falling through to the default.
 *
 * Reasons this can fire:
 * - The workspace overlay or profile default points at a `cellKey` not in
 *   Eve's local registry (most likely a Synap-app-only widget like
 *   `entity-bento` or a custom registered cell).
 * - The resolved target is a `view` or `iframe-srcdoc` or `external-app`
 *   kind — file-path rendering is Phase 3 on Eve.
 *
 * Action for the user: open the entity in Synap Studio, or change the
 * renderer override in the workspace settings.
 */

import { Card, CardBody } from "@heroui/react";
import { AlertCircle } from "lucide-react";

export interface UnsupportedRendererProps {
  kind: string;
  cellKey?: string;
  detail?: string;
}

export function UnsupportedRenderer({
  kind,
  cellKey,
  detail,
}: UnsupportedRendererProps) {
  const label =
    kind === "cell" && cellKey
      ? `Cell renderer "${cellKey}" is not registered in Eve OS yet.`
      : `Renderer kind "${kind}" is not supported in Eve OS yet.`;

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <Card
        shadow="none"
        className="bg-content1 border border-divider max-w-md w-full"
      >
        <CardBody className="p-6 flex flex-col gap-3 items-start">
          <div className="flex items-center gap-2 text-foreground">
            <AlertCircle size={16} strokeWidth={1.75} />
            <p className="text-[14px] font-medium">Renderer not supported</p>
          </div>
          <p className="text-[13px] text-default-500 leading-relaxed">
            {label}
          </p>
          {detail ? (
            <p className="text-[12px] text-default-400 leading-relaxed">
              {detail}
            </p>
          ) : null}
          <p className="text-[12px] text-default-400 leading-relaxed">
            Open this entity in Synap Studio, or change the renderer override
            in workspace settings.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
