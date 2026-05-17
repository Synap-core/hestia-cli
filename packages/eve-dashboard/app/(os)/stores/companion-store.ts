"use client";

/**
 * Companion store — a single side-docked surface that COEXISTS with the
 * active pane, rather than replacing it (the older "wall screen" pattern
 * via `createPortal` on `/apps/[id]`).
 *
 * Visual model: the OS shell shrinks the pane and reveals the companion
 * to its right. One companion at a time; reopening the same kind with
 * the same primary id toggles it closed (dedupe + toggle behavior).
 *
 * Mirrors the style of `overlay-store.ts` (Zustand `create`, single file,
 * named exports), but lives separately because the companion is a
 * layout-level peer to `Pane`, not an overlay stacked above it.
 */

import { create } from "zustand";

export type CompanionKind = "ai-chat"; // future: "vault" | "thread" | "entity-preview"

export interface CompanionPayload {
  url?: string;
  entityId?: string;
  channelId?: string;
  title?: string;
}

interface CompanionState {
  open: boolean;
  kind: CompanionKind | null;
  payload: CompanionPayload | null;
  openCompanion: (kind: CompanionKind, payload: CompanionPayload) => void;
  close: () => void;
  /** Re-opens same kind+primary-id = close (toggle). */
  toggle: (kind: CompanionKind, payload: CompanionPayload) => void;
}

function primaryIdOf(
  _kind: CompanionKind | null,
  payload: CompanionPayload | null,
): string | null {
  if (!payload) return null;
  return payload.entityId ?? payload.channelId ?? payload.url ?? null;
}

export const useCompanionStore = create<CompanionState>((set, get) => ({
  open: false,
  kind: null,
  payload: null,

  openCompanion(kind, payload) {
    set({ open: true, kind, payload });
  },

  close() {
    set({ open: false, kind: null, payload: null });
  },

  toggle(kind, payload) {
    const s = get();
    const sameKind = s.open && s.kind === kind;
    const samePrimary =
      sameKind && primaryIdOf(s.kind, s.payload) === primaryIdOf(kind, payload);
    if (samePrimary) {
      set({ open: false, kind: null, payload: null });
      return;
    }
    set({ open: true, kind, payload });
  },
}));
