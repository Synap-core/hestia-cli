"use client";

/**
 * Eve OS — Data detail (`/data/[id]`).
 *
 * Page-level orchestration only. Fetches the entity, then mounts
 * `<EntityRenderer>` from `@eve/profile-renderer`. The resolver
 * (`podRendererResolver`) calls the pod's `profiles.getEffectiveRenderers`
 * tRPC procedure (workspace overlay → profile default → hardcoded fallback)
 * and returns a `RendererRef`. The `renderTarget` callback dispatches by
 * `kind` and (for cells) by `cellKey` to a registered Eve renderer.
 *
 * Adding a new renderer = add a `cellKey → ComponentType<EveDetailRendererProps>`
 * entry to `EVE_DETAIL_RENDERERS` and create the component. No backend
 * changes; the resolver already returns whatever ref the workspace owner
 * (or, eventually, the AI) put on the profile.
 *
 * File-path renderers (`iframe-srcdoc` / `external-app`) are Phase 3 —
 * for now they show the `UnsupportedRenderer` placeholder.
 *
 * Spec: synap-team-docs/content/team/platform/profile-renderer.mdx
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Card, CardBody, Spinner } from "@heroui/react";
import { ChevronLeft } from "lucide-react";

import { EntityRenderer, type RendererRef } from "@eve/profile-renderer";

import { PaneHeader } from "../../components/pane-header";
import { PodNotPairedCard } from "../../inbox/components/pod-not-paired-card";
import { podTrpcFetch, PodTrpcError } from "@/lib/pod-fetch";
import { podRendererResolver } from "@/lib/profile-renderer-resolver";

import { RendererPicker } from "../components/renderer-picker";
import { EVE_RENDERER_CATALOG } from "../eve-renderer-catalog";
import { EntityDetailRenderer } from "./renderers/entity-detail";
import { UnsupportedRenderer } from "./renderers/unsupported";
import type { Entity, EveDetailRenderer } from "./types";

// ─── Eve's local renderer registry ────────────────────────────────────────────
//
// Maps backend `cellKey` → Eve-native React component. The two entries below
// cover the system-fallback cell key from `ProfileResolutionService` plus the
// canonical "form" alias. Adding a kanban-card / gallery-detail renderer is a
// single entry here + a sibling file in `./renderers/`.

const EVE_DETAIL_RENDERERS: Record<string, EveDetailRenderer> = {
  "entity-detail": EntityDetailRenderer,
  form: EntityDetailRenderer,
};

type DetailState =
  | { kind: "loading" }
  | { kind: "unpaired" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; entity: Entity };

export default function DataDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [refreshToken, setRefreshToken] = useState(0);

  // ─── Fetch entity ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const result = await podTrpcFetch<{ entity?: Entity }>(
          "entities.get",
          { id },
          { workspaceId: null },
        );
        if (cancelled) return;
        const entity = result.entity ?? (result as unknown as Entity);
        if (!entity || !entity.id) {
          setState({ kind: "missing" });
          return;
        }
        setState({ kind: "ready", entity });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof PodTrpcError && err.status === 503) {
          setState({ kind: "unpaired" });
          return;
        }
        if (err instanceof PodTrpcError && err.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        setState({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Failed to load entity",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // ─── Optimistic patch ───────────────────────────────────────────────────────
  const patch = useCallback(
    async (input: Record<string, unknown>) => {
      if (state.kind !== "ready") return;
      const next = { ...state.entity, ...input };
      if ("properties" in input) {
        next.properties = {
          ...(state.entity.properties ?? {}),
          ...(input.properties as Record<string, unknown>),
        };
      }
      setState({ kind: "ready", entity: next });
      try {
        await podTrpcFetch(
          "entities.update",
          { id, ...input },
          { method: "POST", workspaceId: null },
        );
      } catch {
        // Re-fetch authoritative copy on error.
        try {
          const refreshed = await podTrpcFetch<{ entity?: Entity }>(
            "entities.get",
            { id },
            { workspaceId: null },
          );
          if (refreshed.entity) {
            setState({ kind: "ready", entity: refreshed.entity });
          }
        } catch {
          /* keep optimistic state — next reload will reconcile */
        }
      }
    },
    [id, state],
  );

  const onBack = useCallback(() => router.push("/data"), [router]);

  // ─── Non-ready states ──────────────────────────────────────────────────────
  if (state.kind === "loading") {
    return (
      <>
        <PaneHeader title="Loading…" back={onBack} />
        <div className="flex flex-1 items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      </>
    );
  }

  if (state.kind === "unpaired") {
    return (
      <>
        <PaneHeader title="Data" back={onBack} />
        <PodNotPairedCard onOpenSettings={() => router.push("/settings")} />
      </>
    );
  }

  if (state.kind === "missing") {
    return (
      <>
        <PaneHeader title="Not found" back={onBack} />
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
          <p className="text-[13px] text-default-500">
            We couldn&apos;t find that entity.
          </p>
          <Button
            size="sm"
            variant="flat"
            startContent={<ChevronLeft size={14} />}
            onPress={onBack}
          >
            Back to Data
          </Button>
        </div>
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <PaneHeader title="Error" back={onBack} />
        <div className="flex-1 flex items-center justify-center p-8">
          <Card
            shadow="none"
            className="bg-content1 border border-divider max-w-md w-full"
          >
            <CardBody className="p-6 flex flex-col gap-3 items-start">
              <p className="text-[14px] font-medium text-foreground">
                Failed to load entity
              </p>
              <p className="text-[13px] text-default-500">{state.message}</p>
              <Button size="sm" variant="flat" onPress={onBack}>
                Back to Data
              </Button>
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  // ─── Ready: mount EntityRenderer ───────────────────────────────────────────
  return (
    <ResolvedDetail
      entity={state.entity}
      patch={patch}
      onBack={onBack}
      refreshToken={refreshToken}
      onRefresh={() => setRefreshToken((t) => t + 1)}
    />
  );
}

// ─── Renderer host ─────────────────────────────────────────────────────────────

function ResolvedDetail({
  entity,
  patch,
  onBack,
  refreshToken,
  onRefresh,
}: {
  entity: Entity;
  patch: (input: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
  refreshToken: number;
  onRefresh: () => void;
}) {
  const profileSlug = entity.profileSlug ?? entity.type ?? "entity";
  const workspaceId = entity.workspaceId ?? null;
  const [currentCellKey, setCurrentCellKey] = useState<string | undefined>(
    undefined,
  );

  // `renderTarget` is the only place that maps backend kinds → Eve UI.
  // Closure over `entity`/`patch`/`onBack` keeps the registry components
  // free of host plumbing.
  const renderTarget = useMemo(
    () => (target: RendererRef) => {
      // Track what cellKey resolved so the picker can mark the active one.
      if (target.kind === "cell" && target.cellKey !== currentCellKey) {
        // Schedule outside render to avoid setState-during-render warnings.
        queueMicrotask(() => setCurrentCellKey(target.cellKey));
      }

      if (target.kind === "cell") {
        const Renderer = EVE_DETAIL_RENDERERS[target.cellKey];
        if (!Renderer) {
          return (
            <UnsupportedRenderer kind="cell" cellKey={target.cellKey} />
          );
        }
        return (
          <Renderer
            entity={entity}
            config={target.props}
            workspaceId={workspaceId}
            patch={patch}
            onBack={onBack}
          />
        );
      }

      // `view`, `iframe-srcdoc`, `external-app`, `url` — all Phase 3+.
      // Eve will learn how to mount them later; for now, be honest.
      return (
        <UnsupportedRenderer
          kind={target.kind}
          detail={
            target.kind === "iframe-srcdoc" || target.kind === "external-app"
              ? "File-path renderers require the Eve sandbox host (Phase 3)."
              : undefined
          }
        />
      );
    },
    [entity, patch, onBack, workspaceId, currentCellKey],
  );

  return (
    <>
      {/* Picker overlay — pinned top-right, above the renderer's own UI.
          The renderer paints the full page; the picker floats on top so
          any registered renderer (form, document, dashboard, …) gets the
          affordance for free. */}
      <div className="absolute top-3 right-3 z-20">
        <RendererPicker
          profileSlug={profileSlug}
          slot="detail"
          workspaceId={workspaceId}
          currentCellKey={currentCellKey}
          options={EVE_RENDERER_CATALOG.detail}
          onSaved={onRefresh}
        />
      </div>
      <EntityRenderer
        key={refreshToken}
        profileSlug={profileSlug}
        workspaceId={workspaceId}
        entityId={entity.id}
        resolve={podRendererResolver}
        renderTarget={renderTarget}
        fallback={
          <>
            <PaneHeader title="Loading…" back={onBack} />
            <div className="flex flex-1 items-center justify-center py-16">
              <Spinner size="md" />
            </div>
          </>
        }
        empty={
          <UnsupportedRenderer
            kind="(none)"
            detail="The resolver returned no renderer for this profile in this workspace."
          />
        }
        errorFallback={(error) => (
          <UnsupportedRenderer
            kind="(error)"
            detail={`Resolver failed: ${error.message}`}
          />
        )}
      />
    </>
  );
}
