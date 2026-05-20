"use client";

/**
 * `ListRenderer` — Eve OS's built-in list-slot card renderer.
 *
 * Registered against `cellKey: 'list'` (the backend's hardcoded list-slot
 * fallback). Card-per-entity stack. Title + description + click-to-open.
 */

import { Card, CardBody } from "@heroui/react";
import { ChevronRight } from "lucide-react";

import type { EveListRendererProps } from "../types";

export function ListRenderer({ entities, onOpenEntity }: EveListRendererProps) {
  return (
    <div className="flex-1 overflow-y-auto animate-pane-content-in">
      <div className="mx-auto max-w-[1280px] px-5 py-6 sm:py-8 flex flex-col gap-2">
        {entities.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[13px] text-default-500">No entities yet.</p>
          </div>
        ) : (
          entities.map((e) => (
            <Card
              key={e.id}
              shadow="none"
              isPressable
              onPress={() => onOpenEntity(e.id)}
              className="bg-content1 border border-divider hover:border-default-300 transition-colors"
            >
              <CardBody className="p-3 flex flex-row items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-foreground truncate">
                    {e.title ?? "Untitled"}
                  </p>
                  {e.description ? (
                    <p className="text-[12px] text-default-500 truncate mt-0.5">
                      {e.description}
                    </p>
                  ) : null}
                </div>
                <ChevronRight size={14} className="text-default-400 shrink-0" />
              </CardBody>
            </Card>
          ))
        )}
      </div>
      <RendererAttribution cellKey="list" />
    </div>
  );
}

function RendererAttribution({ cellKey }: { cellKey: string }) {
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-10">
      <Card
        shadow="none"
        className="border border-divider bg-content1/80 backdrop-blur-sm"
      >
        <CardBody className="px-2.5 py-1">
          <p className="text-[10px] text-default-400 leading-none">
            Renderer:{" "}
            <span className="text-foreground/70 font-mono">{cellKey}</span>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
