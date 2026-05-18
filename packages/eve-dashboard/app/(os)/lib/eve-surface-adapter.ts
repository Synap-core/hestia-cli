"use client";

import { useCompanionStore } from "../stores/companion-store";

type EveSurfacePlacement = "main" | "side" | "floating" | "modal" | "popover" | "embed";

interface EveSurfaceBase {
  id?: string;
  title?: string;
  placement?: EveSurfacePlacement;
  displayMode?: "compact" | "medium" | "full";
}

interface EveChannelSurface extends EveSurfaceBase {
  kind: "channel";
  channelId: string;
  channelType?: string;
  aiCapable?: boolean;
}

interface EveAppSurface extends EveSurfaceBase {
  kind: "app";
  appId: string;
  url?: string;
  srcdoc?: string;
  rendererType?: "native" | "external" | "iframe-srcdoc";
}

type EveSurface = EveChannelSurface | EveAppSurface;

export interface EveSurfaceOpenResult {
  id: string;
  surface: EveSurface;
  placement: EveSurfacePlacement;
}

export function openEveSurface(
  surface: EveSurface,
  opts: { title?: string; placement?: EveSurfacePlacement } = {},
): EveSurfaceOpenResult | null {
  const placement = opts.placement ?? surface.placement ?? "side";
  const title = opts.title ?? surface.title;

  if (surface.kind === "channel" && isAiCompanionSurface(surface)) {
    useCompanionStore.getState().openCompanion("ai-chat", {
      channelId: surface.channelId,
      title: title ?? "Chat",
    });
    return { id: surface.channelId, surface, placement: "side" };
  }

  if (surface.kind === "app" && surface.rendererType === "iframe-srcdoc" && surface.srcdoc) {
    useCompanionStore.getState().openCompanion("app", {
      appId: surface.appId,
      srcdoc: surface.srcdoc,
      rendererType: "iframe-srcdoc",
      title: title ?? surface.appId,
    });
    return { id: surface.appId, surface, placement };
  }

  if (surface.kind === "app" && surface.rendererType === "external" && surface.url) {
    useCompanionStore.getState().openCompanion("app", {
      appId: surface.appId,
      url: surface.url,
      rendererType: "external",
      title: title ?? surface.appId,
    });
    return { id: surface.appId, surface, placement };
  }

  return null;
}

function isAiCompanionSurface(surface: EveChannelSurface): boolean {
  if (surface.aiCapable !== undefined) {
    return surface.aiCapable;
  }

  const channelType = surface.channelType?.toLowerCase();

  return (
    channelType === "personal" ||
    channelType === "sub_thread" ||
    channelType === "agent_collab"
  );
}
