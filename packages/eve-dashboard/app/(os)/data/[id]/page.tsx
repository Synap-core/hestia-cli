"use client";

/**
 * Eve OS — Data detail (`/data/[id]`).
 *
 * Page-level orchestration only. Three independent fetches:
 *
 *   1. **entity**           — `entities.get` (podProcedure, cross-pod safe)
 *   2. **profile schema**   — `profiles.get` (workspaceProcedure — only
 *                              when the entity has a `workspaceId`).
 *                              Gives us `effectiveProperties` so the
 *                              renderer can build schema-driven widgets
 *                              (status → colored Select, dates → Calendar,
 *                              entity_id → chip, etc.).
 *   3. **connections**      — `relations.getConnections` (protectedProcedure
 *                              — works without workspace). Unified across
 *                              graph relations, structural property links,
 *                              and channel mentions.
 *
 * Once the entity is loaded, schema and connections fetch in parallel and
 * pass straight through to the registered renderer. The page itself does
 * no rendering of entity content — that's the renderer's job.
 *
 * The resolver picks which renderer mounts (via the Renderer Picker the
 * user can swap workspace overrides).
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
import type { Connection } from "./renderers/entity-detail/relations-panel";
import type { EffectivePropertyDef } from "./renderers/entity-detail/field-builder";
import type { Entity, EveDetailRenderer } from "./types";

// ─── Eve's local renderer registry ────────────────────────────────────────────

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

interface SchemaState {
  effectiveProperties?: EffectivePropertyDef[];
  loading: boolean;
}

interface ConnectionsState {
  connections: Connection[];
  loading: boolean;
}

export default function DataDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [schema, setSchema] = useState<SchemaState>({ loading: false });
  const [conns, setConns] = useState<ConnectionsState>({
    connections: [],
    loading: false,
  });
  const [refreshToken, setRefreshToken] = useState(0);

  // ─── Fetch entity ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setState({ kind: "loading" });
    setSchema({ loading: false });
    setConns({ connections: [], loading: false });
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

  // ─── Fetch profile schema (when entity is workspace-scoped) ────────────────
  //
  // `profiles.get` is a workspaceProcedure today, so we can only resolve
  // schema when the entity carries a workspace id. Cross-pod entities skip
  // this fetch and the renderer falls back to `classifyValue()` heuristics
  // for property widgets.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const slug = state.entity.profileSlug ?? state.entity.type;
    const ws = state.entity.workspaceId ?? null;
    if (!slug || !ws) {
      setSchema({ loading: false });
      return;
    }

    let cancelled = false;
    setSchema({ loading: true });
    (async () => {
      try {
        const result = await podTrpcFetch<{
          profile?: unknown;
          effectiveProperties?: EffectivePropertyDef[];
        }>(
          "profiles.get",
          { identifier: slug },
          { workspaceId: ws, method: "GET" },
        );
        if (cancelled) return;
        setSchema({
          loading: false,
          effectiveProperties: result.effectiveProperties ?? [],
        });
      } catch {
        if (cancelled) return;
        // Schema fetch is best-effort — the renderer degrades cleanly to
        // `classifyValue()` when no defs are present.
        setSchema({ loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  // ─── Fetch connections (always, after entity loads) ────────────────────────
  //
  // `relations.getConnections` is a protectedProcedure — no workspace
  // required. Works for cross-pod entities too.
  useEffect(() => {
    if (state.kind !== "ready") return;

    let cancelled = false;
    setConns((prev) => ({ ...prev, loading: true }));
    (async () => {
      try {
        const result = await podTrpcFetch<{ connections?: Connection[] }>(
          "relations.getConnections",
          { entityId: state.entity.id, limit: 50 },
          { workspaceId: null, method: "GET" },
        );
        if (cancelled) return;
        setConns({
          connections: result.connections ?? [],
          loading: false,
        });
      } catch {
        if (cancelled) return;
        setConns({ connections: [], loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

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
  const onOpenEntity = useCallback(
    (entityId: string) => router.push(`/data/${entityId}`),
    [router],
  );

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
      effectiveProperties={schema.effectiveProperties}
      connections={conns.connections}
      connectionsLoading={conns.loading}
      patch={patch}
      onBack={onBack}
      onOpenEntity={onOpenEntity}
      refreshToken={refreshToken}
      onRefresh={() => setRefreshToken((t) => t + 1)}
    />
  );
}

// ─── Renderer host ─────────────────────────────────────────────────────────────

function ResolvedDetail({
  entity,
  effectiveProperties,
  connections,
  connectionsLoading,
  patch,
  onBack,
  onOpenEntity,
  refreshToken,
  onRefresh,
}: {
  entity: Entity;
  effectiveProperties?: EffectivePropertyDef[];
  connections: Connection[];
  connectionsLoading: boolean;
  patch: (input: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
  onOpenEntity: (entityId: string) => void;
  refreshToken: number;
  onRefresh: () => void;
}) {
  const profileSlug = entity.profileSlug ?? entity.type ?? "entity";
  const workspaceId = entity.workspaceId ?? null;
  const [currentCellKey, setCurrentCellKey] = useState<string | undefined>(
    undefined,
  );

  const renderTarget = useMemo(
    () => (target: RendererRef) => {
      if (target.kind === "cell" && target.cellKey !== currentCellKey) {
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
            effectiveProperties={effectiveProperties}
            connections={connections}
            connectionsLoading={connectionsLoading}
            onOpenEntity={onOpenEntity}
          />
        );
      }

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
    [
      entity,
      patch,
      onBack,
      workspaceId,
      currentCellKey,
      effectiveProperties,
      connections,
      connectionsLoading,
      onOpenEntity,
    ],
  );

  return (
    <>
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
