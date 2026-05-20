"use client";

/**
 * `RendererPicker` — Notion-style "Change view" popover.
 *
 * Lists every renderer registered in Eve's catalog for the given slot, marks
 * the current one, and on selection writes a workspace-scoped override via
 * `profiles.setProfileRendererOverride`. The parent page invalidates its
 * resolver (typically by bumping a `refreshToken`) so the new selection
 * takes effect immediately.
 *
 * When `workspaceId === null` (cross-pod entities, list-slot on Eve OS
 * cross-workspace surfaces) the picker is disabled with a tooltip — there's
 * no workspace context to save into. The architecture deliberately keeps
 * renderer choice per-workspace (mirroring the sidebar pattern); per-user
 * overrides would be a future addition.
 *
 * Spec: synap-team-docs/content/team/platform/profile-renderer.mdx
 */

import { useState, useTransition } from "react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@heroui/react";
import { Check, Layers } from "lucide-react";

import type { ProfileRendererSlot } from "@eve/profile-renderer";

import { podTrpcFetch } from "@/lib/pod-fetch";

import type { RendererOption } from "../eve-renderer-catalog";

export interface RendererPickerProps {
  profileSlug: string;
  slot: ProfileRendererSlot;
  /** Workspace to save the override to. `null` disables the picker. */
  workspaceId: string | null;
  /** The currently-active cellKey from the resolved RendererRef. */
  currentCellKey?: string;
  /** Options from `EVE_RENDERER_CATALOG[slot]`. */
  options: RendererOption[];
  /** Called after a successful save — caller should invalidate its resolver. */
  onSaved: () => void;
}

export function RendererPicker({
  profileSlug,
  slot,
  workspaceId,
  currentCellKey,
  options,
  onSaved,
}: RendererPickerProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const disabled = workspaceId === null;

  const select = (cellKey: string) => {
    if (workspaceId === null) return;
    setError(null);
    startTransition(async () => {
      try {
        await podTrpcFetch(
          "profiles.setProfileRendererOverride",
          {
            profileSlug,
            slot,
            ref: { kind: "cell", cellKey, props: {} },
          },
          { method: "POST", workspaceId },
        );
        setOpen(false);
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  };

  const button = (
    <Button
      size="sm"
      variant="flat"
      startContent={<Layers size={14} />}
      isLoading={isPending}
      isDisabled={disabled}
    >
      Change view
    </Button>
  );

  return (
    <Popover isOpen={open} onOpenChange={setOpen} placement="bottom-end">
      <PopoverTrigger>
        {disabled ? (
          <Tooltip content="This entity isn't in a workspace — view choice can't be saved.">
            <div>{button}</div>
          </Tooltip>
        ) : (
          button
        )}
      </PopoverTrigger>
      <PopoverContent className="p-0 min-w-[260px] max-w-[320px]">
        <div className="flex flex-col gap-0.5 p-2">
          <p className="text-[10px] uppercase tracking-widest text-default-400 font-medium px-2 py-1">
            {slot === "detail" ? "Detail view" : "List view"} · {profileSlug}
          </p>
          {options.map((opt) => {
            const isActive = opt.cellKey === currentCellKey;
            return (
              <button
                key={opt.cellKey}
                type="button"
                onClick={() => select(opt.cellKey)}
                className={`flex items-start gap-2 px-2 py-2 rounded-md text-left transition-colors ${
                  isActive
                    ? "bg-default-100"
                    : "hover:bg-default-100"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground">
                    {opt.displayName}
                  </div>
                  {opt.description ? (
                    <div className="text-[11px] text-default-500 leading-snug mt-0.5">
                      {opt.description}
                    </div>
                  ) : null}
                  <div className="text-[10px] font-mono text-default-400 mt-1">
                    {opt.cellKey}
                  </div>
                </div>
                {isActive ? (
                  <Check size={14} className="text-success mt-1 shrink-0" />
                ) : null}
              </button>
            );
          })}
          {error ? (
            <p className="text-[11px] text-danger px-2 py-1">{error}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
