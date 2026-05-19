"use client";

/**
 * Pod data scope — the **only** way Eve OS decides between workspace-scoped
 * and user-wide pod queries. Replaces the old `localStorage.eve.activeWorkspaceId`
 * implicit default that silently degraded every Eve query to "globals only".
 *
 * Architecture:
 *
 *   <ScopeProvider scope={...}>                ← declares the active scope
 *     ...                                       at a subtree (OS shell, an app,
 *     usePodQuery("entities.list", input)       a specific surface).
 *     ...                                      Hooks read the scope and decide
 *   </ScopeProvider>                            which procedure variant to call.
 *
 * Two scope kinds:
 *   - { kind: "user-wide" }                    → prefer `.listAll` procedures;
 *                                                fall back to client-side fan-out
 *                                                when `.listAll` doesn't exist yet.
 *   - { kind: "workspace"; workspaceId: ... }  → call standard `.list` with the
 *                                                workspace header.
 *
 * Studio apps wrap their root with workspace scope (one active workspace).
 * Eve OS wraps its shell with user-wide scope. Surfaces inside Eve that
 * need a specific workspace (e.g. drilling into one) can override locally.
 */

import { createContext, useContext, type ReactNode } from "react";

export type Scope =
  | { kind: "user-wide" }
  | { kind: "workspace"; workspaceId: string };

const ScopeContext = createContext<Scope | null>(null);

export interface ScopeProviderProps {
  scope: Scope;
  children: ReactNode;
}

export function ScopeProvider({ scope, children }: ScopeProviderProps) {
  return (
    <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>
  );
}

/**
 * Reads the active scope. Throws if no provider is mounted — every Eve
 * surface that reads pod data MUST declare its scope explicitly. Silent
 * fallbacks are how Eve ended up showing empty graphs.
 */
export function useScope(): Scope {
  const scope = useContext(ScopeContext);
  if (!scope) {
    throw new Error(
      "useScope called outside a <ScopeProvider>. Wrap your app root with " +
        "<ScopeProvider scope={{ kind: 'user-wide' }}> (Eve OS) or " +
        "<ScopeProvider scope={{ kind: 'workspace', workspaceId }}> (workspace app).",
    );
  }
  return scope;
}

/**
 * Optional variant for surfaces that may render outside a provider (e.g. a
 * pre-auth route). Returns `null` instead of throwing.
 */
export function useScopeOptional(): Scope | null {
  return useContext(ScopeContext);
}
