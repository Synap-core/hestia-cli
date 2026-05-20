"use client";

/**
 * Eve OS — Profiles index (`/data/profiles`).
 *
 * Every entity profile visible to the user, across all their workspaces.
 * Click a profile → `/data/profiles/[slug]` which mounts `<EntityRenderer
 * slot="list">` and shows entities through the resolved list renderer.
 *
 * Sibling to the graph view at `/data` — the graph shows the whole pod as
 * connections, this view shows it as types.
 */

import { useRouter } from "next/navigation";
import { Card, CardBody, Spinner } from "@heroui/react";
import {
  Briefcase,
  Building2,
  Calendar as CalendarIcon,
  ChevronRight,
  FileText,
  Layers,
  StickyNote,
  User,
  type LucideIcon,
} from "lucide-react";

import { PaneHeader } from "../../components/pane-header";
import { PodNotPairedCard } from "../../inbox/components/pod-not-paired-card";
import { usePodQuery } from "@/lib/use-pod-query";

interface Profile {
  id: string;
  slug: string;
  displayName: string;
  scope?: string | null;
  uiHints?: Record<string, unknown> | null;
}

const PROFILE_ICON: Record<string, LucideIcon> = {
  person: User,
  contact: User,
  company: Building2,
  deal: Briefcase,
  project: Layers,
  task: Briefcase,
  document: FileText,
  note: StickyNote,
  event: CalendarIcon,
};

export default function ProfilesIndexPage() {
  const router = useRouter();

  // profiles.listMulti returns every profile the user can access across
  // their workspaces. Pod-scoped — no fan-out needed.
  const { state } = usePodQuery<{ profiles: Profile[] }>(
    "profiles.listMulti",
    {},
    { skipFanout: true },
  );

  if (state.kind === "unpaired") {
    return (
      <>
        <PaneHeader title="Profiles" />
        <div className="flex-1 overflow-y-auto">
          <PodNotPairedCard onOpenSettings={() => router.push("/settings")} />
        </div>
      </>
    );
  }

  return (
    <>
      <PaneHeader title="Profiles" />
      <div className="flex-1 overflow-y-auto animate-pane-content-in">
        <div className="mx-auto max-w-[1280px] px-5 py-6 sm:py-8 flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h2 className="font-heading text-2xl text-foreground tracking-tight">
              Entity profiles
            </h2>
            <p className="text-[13px] text-default-500 max-w-xl">
              Every kind of thing on your pod. Click one to see all entities
              of that type — the renderer (list, table, kanban, …) is set per
              workspace.
            </p>
          </header>

          {state.kind === "loading" ? (
            <div className="py-12 flex items-center justify-center">
              <Spinner size="md" />
            </div>
          ) : state.kind === "error" ? (
            <div className="py-8 text-[13px] text-default-500 text-center">
              {state.message}
            </div>
          ) : state.data.profiles.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-default-500">
              No profiles yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {state.data.profiles.map((p) => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  onOpen={() =>
                    router.push(
                      `/data/profiles/${encodeURIComponent(p.slug)}`,
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ProfileCard({
  profile,
  onOpen,
}: {
  profile: Profile;
  onOpen: () => void;
}) {
  const Icon = PROFILE_ICON[profile.slug] ?? Layers;
  return (
    <Card
      shadow="none"
      isPressable
      onPress={onOpen}
      className="bg-content1 border border-divider hover:border-default-300 transition-colors"
    >
      <CardBody className="p-4 flex flex-row items-center gap-3">
        <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-default-100 text-foreground border border-divider">
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-medium text-foreground truncate">
            {profile.displayName}
          </p>
          <p className="text-[11px] text-default-400 font-mono truncate">
            {profile.slug}
          </p>
        </div>
        <ChevronRight size={14} className="text-default-400 shrink-0" />
      </CardBody>
    </Card>
  );
}
