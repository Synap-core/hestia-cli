"use client";

/**
 * `CardActionRow` — per-card action buttons.
 *
 * Renders the right-side button cluster on a marketplace card.
 * Behaviour depends on `appType` and (for eve_components) the local
 * install state surfaced via `/api/components`.
 *
 *   appType === "url"
 *     [ Open ]                              → opens app.appUrl inside Eve.
 *
 *   appType === "eve_component", not installed locally
 *     [ Open ] [ Add to Eve ]               → Open shows the cloud preview
 *                                              (app.appUrl); Add to Eve fires
 *                                              the install POST and switches
 *                                              into the working/installed state.
 *
 *   appType === "eve_component", installed AND running
 *     [ Open ]                              → Open uses the local URL inside Eve
 *                                              (e.g. http://hostname:11434).
 *
 *   appType === "eve_component", installed but stopped
 *     [ Installed ] (disabled)              → operator must start it from the
 *                                              component page; lifecycle isn't
 *                                              this surface's job.
 *
 * Locked apps (`isLocked`) render nothing — the top-right Lock chip
 * is the action and the whole card is the upgrade hit area.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Loader2,
  Plus,
} from "lucide-react";
import {
  CpUnauthorizedError,
  installApp,
  MarketplaceError,
  type MarketplaceAppWithEntitlement,
} from "../../lib/marketplace-client";
import { createEmbeddedAppHref } from "../../lib/app-launch-url";

export interface LocalComponentRef {
  installed: boolean;
  running: boolean;
  url: string | null;
}

interface CardActionRowProps {
  app: MarketplaceAppWithEntitlement;
  /** Local component telemetry (eve_component only). `null` for `url` apps. */
  localRef: LocalComponentRef | null;
  /** True when the user lacks an entitlement; we hide actions in that case. */
  isLocked: boolean;
  /** Refresh the catalog after a successful install (entitlement flips). */
  onInstalled: () => void;
}

type InstallState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string };

export function CardActionRow({
  app,
  localRef,
  isLocked,
  onInstalled,
}: CardActionRowProps) {
  if (isLocked) return null;

  if (app.appType === "url") {
    return <UrlOpenButton app={app} onInstalled={onInstalled} />;
  }

  if (app.appType === "eve_component") {
    return (
      <EveComponentActions
        app={app}
        localRef={localRef}
        onInstalled={onInstalled}
      />
    );
  }

  // workspace_pack / bundle aren't rendered on this surface.
  return null;
}

// ─── Url apps ────────────────────────────────────────────────────────────────

function UrlOpenButton({
  app,
  onInstalled,
}: {
  app: MarketplaceAppWithEntitlement;
  onInstalled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const handleOpen = async () => {
    if (!app.appUrl) return;
    router.push(
      createEmbeddedAppHref({
        id: app.slug,
        name: app.name,
        url: app.appUrl,
        requiresAuth: isTrustedSynapUrl(app.appUrl),
      }),
    );

    // Fire-and-forget click record so install_count increments. The pane opens
    // immediately — we don't make the user wait on the POST.
    if (busy) return;
    setBusy(true);
    try {
      await installApp(
        { slug: app.slug },
        { onUnauthorized: () => { /* anonymous click — silent */ } },
      );
      onInstalled();
    } catch {
      // Click tracking is best-effort.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      radius="full"
      variant="flat"
      color="primary"
      startContent={<ExternalLink className="h-3.5 w-3.5" />}
      onPress={handleOpen}
      aria-label={`Open ${app.name}`}
      isDisabled={!app.appUrl}
    >
      Open
    </Button>
  );
}

// ─── Eve components ──────────────────────────────────────────────────────────

function EveComponentActions({
  app,
  localRef,
  onInstalled,
}: {
  app: MarketplaceAppWithEntitlement;
  localRef: LocalComponentRef | null;
  onInstalled: () => void;
}) {
  const [state, setState] = useState<InstallState>({ kind: "idle" });
  const router = useRouter();

  const openEmbedded = (url: string, idSuffix?: string) => {
    router.push(
      createEmbeddedAppHref({
        id: idSuffix ? `${app.slug}-${idSuffix}` : app.slug,
        name: app.name,
        url,
        requiresAuth: isTrustedSynapUrl(url),
      }),
    );
  };

  // Installed + running locally → single Open button to the local URL.
  if (localRef?.installed && localRef.running && localRef.url) {
    return (
      <Button
        size="sm"
        radius="full"
        variant="flat"
        color="success"
        startContent={<ExternalLink className="h-3.5 w-3.5" />}
        onPress={() => openEmbedded(localRef.url ?? "", "local")}
        aria-label={`Open ${app.name} on this Eve`}
      >
        Open
      </Button>
    );
  }

  // Installed but not running → flag it; lifecycle lives elsewhere.
  if (localRef?.installed) {
    return (
      <Button
        size="sm"
        radius="full"
        variant="flat"
        color="default"
        startContent={<Check className="h-3.5 w-3.5" />}
        isDisabled
      >
        Installed
      </Button>
    );
  }

  const handleAdd = async () => {
    if (state.kind === "working") return;
    setState({ kind: "working" });
    try {
      await installApp(
        { slug: app.slug },
        { onUnauthorized: () => { /* banner takes over */ } },
      );
      setState({ kind: "idle" });
      onInstalled();
    } catch (err) {
      if (err instanceof CpUnauthorizedError) {
        setState({ kind: "idle" });
        return;
      }
      const message =
        err instanceof MarketplaceError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Install failed";
      setState({ kind: "error", message });
    }
  };

  if (state.kind === "error") {
    return (
      <Button
        size="sm"
        radius="full"
        variant="flat"
        color="danger"
        startContent={<AlertCircle className="h-3.5 w-3.5" />}
        onPress={handleAdd}
        aria-label={`Retry install of ${app.name}`}
      >
        Retry
      </Button>
    );
  }

  const isWorking = state.kind === "working";

  return (
    <div className="flex items-center gap-1.5">
      {app.appUrl && (
        <Button
          size="sm"
          radius="full"
          variant="light"
          color="default"
          startContent={<ExternalLink className="h-3.5 w-3.5" />}
          onPress={() => openEmbedded(app.appUrl ?? "", "preview")}
          aria-label={`Preview ${app.name}`}
        >
          Open
        </Button>
      )}
      <Button
        size="sm"
        radius="full"
        variant="flat"
        color="primary"
        isDisabled={isWorking}
        startContent={
          isWorking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )
        }
        onPress={handleAdd}
        aria-label={`Add ${app.name} to your Eve`}
      >
        {isWorking ? "Adding…" : "Add to Eve"}
      </Button>
    </div>
  );
}

function isTrustedSynapUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".synap.live");
  } catch {
    return false;
  }
}
