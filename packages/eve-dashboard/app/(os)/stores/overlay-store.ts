"use client";

// Types mirror @synap-core/overlay-protocol — replace with import once published.
export type SystemOverlayKind =
  | "command"
  | "switcher"
  | "agent"
  | "vault"
  | "permission"
  | "cell";

export interface OverlayEntry {
  id: string;
  kind: SystemOverlayKind;
  payload?: Record<string, unknown>;
}

interface OverlayStore {
  stack: OverlayEntry[];
  open: (kind: SystemOverlayKind, payload?: Record<string, unknown>) => void;
  close: (id?: string) => void;
  replace: (kind: SystemOverlayKind, payload?: Record<string, unknown>) => void;
  isOpen: (kind: SystemOverlayKind) => boolean;
}

import { create } from "zustand";

let _counter = 0;

export const useOverlayStore = create<OverlayStore>((set, get) => ({
  stack: [],

  open(kind, payload) {
    const id = `ov-${++_counter}`;
    set((s) => ({ stack: [...s.stack, { id, kind, payload }] }));
  },

  close(id) {
    set((s) => ({
      stack: id ? s.stack.filter((e) => e.id !== id) : s.stack.slice(0, -1),
    }));
  },

  replace(kind, payload) {
    const id = `ov-${++_counter}`;
    set((s) => ({
      stack: [...s.stack.slice(0, -1), { id, kind, payload }],
    }));
  },

  isOpen(kind) {
    return get().stack.some((e) => e.kind === kind);
  },
}));
