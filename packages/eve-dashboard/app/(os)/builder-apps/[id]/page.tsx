"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Spinner } from "@heroui/react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { AppPane } from "../../components/app-pane";
import { PaneHeader } from "../../components/pane-header";
import {
  normalizeAppEntitiesToManifests,
  type AppEntityLike,
  type EveAppManifest,
} from "../../lib/eve-app-manifest";

interface AppsResponse {
  apps: AppEntityLike[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; manifest: EveAppManifest }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export default function BuilderAppPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const appId = useMemo(() => decodeURIComponent(params.id), [params.id]);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ kind: "loading" });
      try {
        const res = await fetch("/api/apps", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`/api/apps returned ${res.status}`);
        }
        const json = (await res.json()) as AppsResponse;
        const manifest =
          normalizeAppEntitiesToManifests(json.apps ?? []).find(
            (item) => item.id === appId,
          ) ?? null;
        if (cancelled) return;
        setState(manifest ? { kind: "ready", manifest } : { kind: "missing" });
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not load app",
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [appId, reloadKey]);

  const title = state.kind === "ready" ? state.manifest.name : "Builder app";

  return (
    <>
      <PaneHeader
        title={title}
        back={() => router.push("/")}
        actions={
          state.kind === "ready" &&
          state.manifest.rendererType === "external" &&
          state.manifest.url ? (
            <Button
              isIconOnly
              variant="light"
              size="sm"
              radius="full"
              aria-label="Open in new tab"
              onPress={() => window.open(state.manifest.url, "_blank", "noreferrer")}
              className="text-foreground/55 hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={2} />
            </Button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        {state.kind === "loading" && <CenteredStatus label="Loading app…" busy />}
        {state.kind === "missing" && (
          <CenteredStatus label="This Builder app is not available." />
        )}
        {state.kind === "error" && (
          <CenteredStatus
            label={state.message}
            action={
              <Button
                size="sm"
                radius="full"
                variant="flat"
                startContent={<RefreshCw className="h-3 w-3" />}
                onPress={() => setReloadKey((value) => value + 1)}
              >
                Retry
              </Button>
            }
          />
        )}
        {state.kind === "ready" &&
          state.manifest.rendererType === "external" &&
          state.manifest.url && (
            <AppPane appId={state.manifest.id} url={state.manifest.url} />
          )}
        {state.kind === "ready" &&
          state.manifest.rendererType === "iframe-srcdoc" &&
          state.manifest.srcdoc && (
            <SrcdocPane appId={state.manifest.id} srcdoc={state.manifest.srcdoc} />
          )}
      </div>
    </>
  );
}

function CenteredStatus({
  label,
  action,
  busy,
}: {
  label: string;
  action?: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {busy && <Spinner size="sm" color="primary" />}
      <p className="text-sm text-foreground/55">{label}</p>
      {action}
    </div>
  );
}

function SrcdocPane({ appId, srcdoc }: { appId: string; srcdoc: string }) {
  return (
    <iframe
      srcDoc={srcdoc}
      title={appId}
      className="h-full w-full border-0 bg-background"
      sandbox="allow-scripts allow-forms allow-popups allow-downloads"
      allow="clipboard-read; clipboard-write"
    />
  );
}
