"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Spinner } from "@heroui/react";
import { ExternalLink, Maximize2, Minimize2, RefreshCw } from "lucide-react";
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
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const content = (
    <>
      <PaneHeader
        title={title}
        back={() => router.push("/")}
        actions={
          state.kind === "ready" ? (
            <>
              <Button
                isIconOnly
                variant="light"
                size="sm"
                radius="full"
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                onPress={() => setIsFullscreen((value) => !value)}
                className="text-foreground/55 hover:text-foreground"
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <Maximize2 className="h-4 w-4" strokeWidth={2} />
                )}
              </Button>
              {state.manifest.rendererType === "external" && state.manifest.url ? (
                <Button
                  isIconOnly
                  variant="light"
                  size="sm"
                  radius="full"
                  aria-label="Open in new tab"
                  onPress={() => window.open(state.manifest.url, "_blank", "noopener,noreferrer")}
                  className="text-foreground/55 hover:text-foreground"
                >
                  <ExternalLink className="h-4 w-4" strokeWidth={2} />
                </Button>
              ) : null}
            </>
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
            <AppPane
              appId={state.manifest.id}
              url={state.manifest.url}
              sendAuth={state.manifest.requiresAuth === true}
            />
          )}
        {state.kind === "ready" &&
          state.manifest.rendererType === "iframe-srcdoc" &&
          state.manifest.srcdoc && (
            <SrcdocPane appId={state.manifest.id} srcdoc={state.manifest.srcdoc} />
          )}
      </div>
    </>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        {content}
      </div>
    );
  }

  return content;
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
  const renderedSrcdoc = useMemo(() => createGeneratedSrcdoc(srcdoc), [srcdoc]);

  return (
    <iframe
      srcDoc={renderedSrcdoc}
      title={appId}
      className="h-full w-full border-0 bg-background"
      sandbox="allow-scripts allow-forms allow-popups allow-downloads"
      allow="clipboard-read; clipboard-write"
    />
  );
}

const GENERATED_APP_SDK = `
(function() {
  var _onInit, _onUpdate;
  var post = function(msg) { window.parent.postMessage(msg, '*'); };
  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'synap:init' && typeof _onInit === 'function') {
      _onInit(e.data.config, e.data.context);
    } else if (e.data.type === 'synap:update' && typeof _onUpdate === 'function') {
      _onUpdate(e.data.config);
    }
  });
  window.SynapWidget = {
    onInit: function(fn) { _onInit = fn; post({ type: 'synap:ready' }); },
    onUpdate: function(fn) { _onUpdate = fn; },
    resize: function(height) { post({ type: 'synap:resize', height: height }); },
    navigate: function(target) { post({ type: 'synap:navigate', target: target }); },
    toast: function(message, level) { post({ type: 'synap:toast', message: message, level: level || 'info' }); },
    error: function(message) { post({ type: 'synap:error', message: message }); }
  };
})();
`;

const GENERATED_APP_BASE_STYLES = `
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
`;

function createGeneratedSrcdoc(source: string): string {
  const injectedHead = `<meta charset="utf-8">
<style data-eve-generated-app-v1>${GENERATED_APP_BASE_STYLES}</style>
<script>${GENERATED_APP_SDK}</script>`;
  const trimmed = source.trimStart().toLowerCase();

  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
    if (/<head\b[^>]*>/i.test(source)) {
      return source.replace(/<head\b[^>]*>/i, (match) => `${match}\n${injectedHead}`);
    }
    if (/<html\b[^>]*>/i.test(source)) {
      return source.replace(/<html\b[^>]*>/i, (match) => `${match}\n<head>${injectedHead}</head>`);
    }
  }

  return `<!doctype html><html><head>${injectedHead}</head><body>${source}</body></html>`;
}
