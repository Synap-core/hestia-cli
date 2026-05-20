"use client";

import { Card, CardBody } from "@heroui/react";
import { AlertCircle } from "lucide-react";

/**
 * Honest placeholder when the resolved list-slot renderer isn't one Eve
 * knows how to mount. Mirrors the detail page's `UnsupportedRenderer`.
 */
export function UnsupportedListRenderer({
  kind,
  cellKey,
  detail,
}: {
  kind: string;
  cellKey?: string;
  detail?: string;
}) {
  const label =
    kind === "cell" && cellKey
      ? `List renderer "${cellKey}" is not registered in Eve OS yet.`
      : `List renderer kind "${kind}" is not supported in Eve OS yet.`;

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <Card
        shadow="none"
        className="bg-content1 border border-divider max-w-md w-full"
      >
        <CardBody className="p-6 flex flex-col gap-3 items-start">
          <div className="flex items-center gap-2 text-foreground">
            <AlertCircle size={16} strokeWidth={1.75} />
            <p className="text-[14px] font-medium">
              List renderer not supported
            </p>
          </div>
          <p className="text-[13px] text-default-500 leading-relaxed">
            {label}
          </p>
          {detail ? (
            <p className="text-[12px] text-default-400 leading-relaxed">
              {detail}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
