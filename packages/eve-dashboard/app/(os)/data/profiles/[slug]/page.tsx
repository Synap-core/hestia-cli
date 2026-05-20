"use client";

/**
 * Eve OS — Profile list (`/data/profiles/[slug]`).
 *
 * List slot for one entity profile. Fetches every entity of that profile
 * across the user's workspaces via `entities.listAll`, then mounts
 * `<EntityRenderer slot="list">` and dispatches to a registered Eve
 * list-slot renderer (`list` cards / `table`).
 *
 * Spec: synap-team-docs/content/team/platform/profile-renderer.mdx
 */

import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Spinner } from "@heroui/react";

import {
  EntityRenderer,
  type RendererRef,
} from "@eve/profile-renderer";

import { PaneHeader } from "../../../components/pane-header";
import { PodNotPairedCard } from "../../../inbox/components/pod-not-paired-card";
import { usePodQuery } from "@/lib/use-pod-query";
import { podRendererResolver } from "@/lib/profile-renderer-resolver";

import { ListRenderer } from "./renderers/list";
import { TableRenderer } from "./renderers/table";
import { UnsupportedListRenderer } from "./renderers/unsupported";
import type { Entity, EveListRenderer } from "./types";

const EVE_LIST_RENDERERS: Record<string, EveListRenderer> = {
  list: ListRenderer,
  table: TableRenderer,
};

interface ListResponse {
  items?: Entity[];
  entities?: Entity[];
}

export default function ProfileListPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const profileSlug = decodeURIComponent(params.slug ?? "");
  const [refreshToken] = useState(0);
  // refreshToken is reserved for the picker-driven invalidation (see
  // detail page). The list-slot picker is currently disabled on Eve
  // (cross-pod surface — no single workspace to save the override to).

  const onBack = useCallback(
    () => router.push("/data/profiles"),
    [router],
  );
  const onOpenEntity = useCallback(
    (id: string) => router.push(`/data/${id}`),
    [router],
  );

  // Fetch every entity of this profile, user-wide (Eve crosses workspaces).
  // ScopeProvider mounted at the OS shell level routes to `entities.listAll`.
  const { state } = usePodQuery<ListResponse>(
    "entities.list",
    { profileSlug, limit: 200 },
    { userWideProcedure: "entities.listAll" },
  );

  if (state.kind === "unpaired") {
    return (
      <>
        <PaneHeader title={profileSlug} back={onBack} />
        <PodNotPairedCard onOpenSettings={() => router.push("/settings")} />
      </>
    );
  }

  if (state.kind === "loading") {
    return (
      <>
        <PaneHeader title={profileSlug} back={onBack} />
        <div className="flex flex-1 items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <PaneHeader title={profileSlug} back={onBack} />
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-[13px] text-default-500">{state.message}</p>
        </div>
      </>
    );
  }

  const entities: Entity[] =
    state.data.items ?? state.data.entities ?? [];

  return (
    <ResolvedList
      profileSlug={profileSlug}
      entities={entities}
      onBack={onBack}
      onOpenEntity={onOpenEntity}
      refreshToken={refreshToken}
    />
  );
}

function ResolvedList({
  profileSlug,
  entities,
  onBack,
  onOpenEntity,
  refreshToken,
}: {
  profileSlug: string;
  entities: Entity[];
  onBack: () => void;
  onOpenEntity: (id: string) => void;
  refreshToken: number;
}) {
  const renderTarget = useMemo(
    () => (target: RendererRef) => {
      if (target.kind === "cell") {
        const Renderer = EVE_LIST_RENDERERS[target.cellKey];
        if (!Renderer) {
          return (
            <UnsupportedListRenderer kind="cell" cellKey={target.cellKey} />
          );
        }
        return (
          <Renderer
            profileSlug={profileSlug}
            entities={entities}
            config={target.props}
            onOpenEntity={onOpenEntity}
          />
        );
      }
      return (
        <UnsupportedListRenderer
          kind={target.kind}
          detail={
            target.kind === "iframe-srcdoc" || target.kind === "external-app"
              ? "File-path renderers require the Eve sandbox host (Phase 3)."
              : undefined
          }
        />
      );
    },
    [profileSlug, entities, onOpenEntity],
  );

  return (
    <>
      <PaneHeader title={profileSlug} back={onBack} />
      <EntityRenderer
        key={refreshToken}
        profileSlug={profileSlug}
        workspaceId={null}
        resolve={podRendererResolver}
        renderTarget={renderTarget}
        fallback={
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner size="md" />
          </div>
        }
        empty={
          <UnsupportedListRenderer
            kind="(none)"
            detail="The resolver returned no renderer for this profile."
          />
        }
        errorFallback={(error) => (
          <UnsupportedListRenderer
            kind="(error)"
            detail={`Resolver failed: ${error.message}`}
          />
        )}
      />
    </>
  );
}
