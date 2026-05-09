"use client";

/**
 * Eve OS — App detail page (`/marketplace/[slug]`).
 *
 * Opens inside the OS pane — no new tab, no leaving Eve. Fetches the
 * full catalog and filters to the matching slug (the CP has no
 * single-app endpoint; the list is small and cached per-request).
 *
 * Sections:
 *   • Hero (icon + name + pitch + meta + CTA)
 *   • About (metadata.longDescription, when present)
 *   • How to launch (type-specific instructions + install widget)
 *
 * Install CTA per app type:
 *   eve_component  →  `eve install <slug>` code block + "Launch installer"
 *                     deep-link button (`eve://install?slug=<slug>`).
 *   workspace_pack →  opens app.synap.live/templates/install?slug=<slug>.
 *   url            →  opens appUrl in a new tab.
 *
 * See: synap-team-docs/content/team/platform/eve-os-roadmap.mdx M5.2
 *      synap-team-docs/content/team/platform/marketplace-landing-design.mdx §4.4
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Chip, Spinner } from "@heroui/react";
import { ExternalLink, Lock, Terminal } from "lucide-react";
import { CpAuthBanner, type CpAuthBannerState } from "../../../components/cp-auth-banner";
import { PaneHeader } from "../../components/pane-header";
import { brandColorFor } from "../../lib/brand-colors";
import {
  CpUnauthorizedError,
  fetchMarketplaceApps,
  MarketplaceError,
  type MarketplaceAppWithEntitlement,
} from "../../lib/marketplace-client";
import { CardActionRow, type LocalComponentRef } from "../components/card-actions";

// ─── Pricing label ────────────────────────────────────────────────────────────

function pricingLabel(p: MarketplaceAppWithEntitlement["pricing"]): string {
  if (!p || p.model === "free") return "Free";
  if (p.model === "subscription" && p.amount) {
    const each = p.interval === "year" ? "yr" : "mo";
    return `${p.amount} ${p.currency ?? "EUR"}/${each}`;
  }
  if (p.model === "one_time" && p.amount) {
    return `${p.amount} ${p.currency ?? "EUR"}`;
  }
  return "Paid";
}

function readMeta(app: MarketplaceAppWithEntitlement, key: string): string | null {
  const v = (app.metadata ?? {})[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

// ─── Local component row (mirror of /api/components) ─────────────────────────

interface LocalComponentRow {
  id: string;
  installed: boolean;
  containerRunning: boolean | null;
  hostPort: number | null;
  domainUrl: string | null;
}

interface ComponentsResponse {
  components: LocalComponentRow[];
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MarketplaceDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [app, setApp] = useState<MarketplaceAppWithEntitlement | null>(null);
  const [localRef, setLocalRef] = useState<LocalComponentRef | null>(null);
  const [bannerState, setBannerState] = useState<CpAuthBannerState>({
    kind: "working",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);

    const [marketResult, localResult] = await Promise.allSettled([
      fetchMarketplaceApps({ onUnauthorized: () => {} }),
      fetch("/api/components", { credentials: "include", cache: "no-store" }).then(
        (r): Promise<ComponentsResponse | null> =>
          r.ok ? (r.json() as Promise<ComponentsResponse>) : Promise.resolve(null),
      ),
    ]);

    if (marketResult.status === "fulfilled") {
      const found = marketResult.value.apps.find((a) => a.slug === slug) ?? null;
      setApp(found);
      if (!found) setNotFound(true);
      setBannerState({ kind: "working" });
    } else {
      const err = marketResult.reason;
      if (err instanceof CpUnauthorizedError) {
        setBannerState({ kind: "signed-out" });
      } else if (err instanceof MarketplaceError) {
        setBannerState({ kind: "error", message: err.message });
      } else {
        setBannerState({
          kind: "error",
          message: err instanceof Error ? err.message : "Marketplace unreachable",
        });
      }
    }

    if (localResult.status === "fulfilled" && localResult.value) {
      const componentId = slug;
      const row = localResult.value.components.find((c) => c.id === componentId);
      if (row) {
        setLocalRef({
          installed: row.installed,
          running: row.containerRunning === true,
          url:
            row.domainUrl ??
            (row.hostPort && typeof window !== "undefined"
              ? `http://${window.location.hostname}:${row.hostPort}`
              : null),
        });
      }
    }

    setIsLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PaneHeader
        title={app?.name ?? "App"}
        back={() => router.push("/marketplace")}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-4 sm:px-6 sm:pt-5">
        {bannerState.kind !== "working" && (
          <div className="mb-4">
            <CpAuthBanner state={bannerState} onRetry={load} />
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner size="md" />
          </div>
        ) : notFound ? (
          <NotFound onBack={() => router.push("/marketplace")} />
        ) : app ? (
          <AppDetail app={app} localRef={localRef} onRefresh={load} />
        ) : null}
      </div>
    </>
  );
}

// ─── Not found ────────────────────────────────────────────────────────────────

function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="text-[14px] text-foreground/55">
        App not found in the marketplace.
      </p>
      <Button size="sm" variant="flat" onPress={onBack}>
        Back to Marketplace
      </Button>
    </div>
  );
}

// ─── App detail ───────────────────────────────────────────────────────────────

function AppDetail({
  app,
  localRef,
  onRefresh,
}: {
  app: MarketplaceAppWithEntitlement;
  localRef: LocalComponentRef | null;
  onRefresh: () => void;
}) {
  const palette = brandColorFor(app.slug);
  const isLocked = !app.entitled;
  const pricing = pricingLabel(app.pricing);
  const longDescription = readMeta(app, "longDescription");
  const docs = readMeta(app, "docs");

  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <header className="flex items-start gap-4">
        <span
          className="
            glass-icon flex h-16 w-16 shrink-0 items-center justify-center rounded-xl
          "
          style={{ background: palette.bg }}
          aria-hidden
        >
          {app.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={app.iconUrl}
              alt=""
              width={36}
              height={36}
              className="rounded-lg"
            />
          ) : (
            <span className="text-[26px] font-medium text-white/95">
              {app.name.charAt(0).toUpperCase()}
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-foreground">
              {app.name}
            </h1>
            {isLocked && (
              <span
                className="
                  inline-flex shrink-0 items-center gap-1
                  rounded-full border border-warning/30 bg-warning/15
                  px-2 py-0.5
                  text-[10.5px] font-medium uppercase tracking-[0.04em] text-warning
                "
                aria-label="Locked — upgrade required"
              >
                <Lock className="h-2.5 w-2.5" strokeWidth={2.4} />
                {pricing}
              </span>
            )}
          </div>

          {app.description && (
            <p className="mt-1 text-[13.5px] leading-snug text-foreground/65">
              {app.description}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-foreground/50">
            <span>{app.category}</span>
            {!isLocked && (
              <>
                <span className="text-foreground/25">·</span>
                <span>{pricing}</span>
              </>
            )}
            {app.installCount > 0 && (
              <>
                <span className="text-foreground/25">·</span>
                <span>{app.installCount} installs</span>
              </>
            )}
          </div>

          {/* Quick-action row — same buttons as the catalog card */}
          {!isLocked && (
            <div className="mt-3">
              <CardActionRow
                app={app}
                localRef={localRef}
                isLocked={false}
                onInstalled={onRefresh}
              />
            </div>
          )}
        </div>
      </header>

      {/* About */}
      {longDescription && (
        <section className="rounded-xl bg-foreground/[0.03] px-4 py-4 ring-1 ring-inset ring-foreground/10">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground/45">
            About
          </h2>
          <p className="text-[13.5px] leading-relaxed text-foreground/80">
            {longDescription}
          </p>
        </section>
      )}

      {/* How to launch */}
      {!isLocked && (
        <section>
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-foreground/45">
            How to launch
          </h2>
          <LaunchInstructions app={app} />
        </section>
      )}

      {/* Docs link */}
      {docs && (
        <Button
          as="a"
          href={docs}
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
          variant="flat"
          color="default"
          className="self-start"
          startContent={<ExternalLink className="h-3.5 w-3.5" />}
        >
          Docs
        </Button>
      )}
    </div>
  );
}

// ─── Launch instructions ──────────────────────────────────────────────────────

function LaunchInstructions({
  app,
}: {
  app: MarketplaceAppWithEntitlement;
}) {
  if (app.appType === "url") {
    return (
      <div className="rounded-xl bg-foreground/[0.03] px-4 py-4 ring-1 ring-inset ring-foreground/10">
        <p className="text-[13.5px] leading-relaxed text-foreground/70">
          Open{" "}
          {app.appUrl ? (
            <span className="font-mono text-[12.5px] text-foreground/85">
              {app.appUrl.replace(/^https?:\/\//, "")}
            </span>
          ) : (
            "the app URL"
          )}{" "}
          in any browser. Sign in with your Synap account — the app authenticates
          against your pod automatically.
        </p>
      </div>
    );
  }

  if (app.appType === "eve_component") {
    return <EveComponentInstall app={app} />;
  }

  if (app.appType === "workspace_pack") {
    return (
      <div className="rounded-xl bg-foreground/[0.03] px-4 py-4 ring-1 ring-inset ring-foreground/10">
        <p className="text-[13.5px] leading-relaxed text-foreground/70">
          Workspace packs install into your Synap pod as a new workspace lens.
          Click below to launch the install flow on{" "}
          <span className="font-mono text-[12.5px] text-foreground/85">
            app.synap.live
          </span>
          .
        </p>
        <Button
          as="a"
          href={`https://app.synap.live/templates/install?slug=${encodeURIComponent(app.slug)}`}
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
          radius="full"
          variant="flat"
          color="primary"
          className="mt-3"
          startContent={<ExternalLink className="h-3.5 w-3.5" />}
        >
          Add to your pod
        </Button>
      </div>
    );
  }

  return null;
}

// ─── Eve component install widget ─────────────────────────────────────────────

function EveComponentInstall({
  app,
}: {
  app: MarketplaceAppWithEntitlement;
}) {
  const [launched, setLaunched] = useState(false);

  const handleLaunch = () => {
    window.location.href = `eve://install?slug=${encodeURIComponent(app.slug)}`;
    setLaunched(true);
  };

  return (
    <div className="rounded-xl bg-foreground/[0.03] px-4 py-4 ring-1 ring-inset ring-foreground/10">
      <p className="text-[13.5px] leading-relaxed text-foreground/70">
        Install on your self-hosted Eve stack via the CLI:
      </p>

      {/* CLI code block */}
      <div
        className="
          mt-3 flex items-center gap-2 rounded-lg
          bg-foreground/[0.06] px-3.5 py-2.5
          ring-1 ring-inset ring-foreground/10
        "
      >
        <Terminal
          className="h-3.5 w-3.5 shrink-0 text-foreground/40"
          strokeWidth={2}
        />
        <code className="select-all font-mono text-[12.5px] text-foreground/85">
          eve install {app.slug}
        </code>
      </div>

      {/* Deep-link button — fires eve://install if a native handler is registered */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          radius="full"
          variant="flat"
          color="primary"
          startContent={<Terminal className="h-3.5 w-3.5" />}
          onPress={handleLaunch}
        >
          {launched ? "Installer launched" : "Launch installer"}
        </Button>
        {launched && (
          <span className="text-[11.5px] text-foreground/45">
            If nothing opened, use the CLI command above.
          </span>
        )}
      </div>
    </div>
  );
}
