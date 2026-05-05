"use client";

/**
 * Pulse — Connectivity sub-cards.
 *
 * Three cards in a 1- / 2- / 3-column grid:
 *
 *   • Pod    — paired? URL? sync state?
 *   • CP     — signed in? token present?
 *   • Domain — configured? SSL? Traefik live?
 *
 * Data sources:
 *   GET /api/secrets-summary        → CP + pod credential presence
 *   GET /api/networking             → domain + traefik state
 *   GET /api/components/synap/info  → pod URL + version
 *
 * Each card shows: a status dot (success / warning / muted), a title,
 * a one-line summary, and a small key/value pair list. We deliberately
 * avoid icons on the dots — the color carries the signal, the words
 * carry the meaning.
 */

import { Card } from "@heroui/react";
import { Globe, Database, Cloud, Check, Minus, AlertTriangle, type LucideIcon } from "lucide-react";
import type { SecretsSummary, NetworkingInfo, PodInfo } from "./types";

export interface ConnectivityProps {
  secrets: SecretsSummary | null;
  networking: NetworkingInfo | null;
  podInfo: PodInfo | null;
}

export function Connectivity({ secrets, networking, podInfo }: ConnectivityProps) {
  const pod = podCard(secrets, podInfo);
  const cp = cpCard(secrets);
  const domain = domainCard(networking);

  return (
    <section>
      <header className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[14px] font-medium text-foreground">Connectivity</h2>
        <span className="ml-2 text-[11.5px] text-foreground/55">
          How Eve talks to the outside world.
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ConnectivityCard {...pod} />
        <ConnectivityCard {...cp} />
        <ConnectivityCard {...domain} />
      </div>
    </section>
  );
}

// ─── Card primitive ──────────────────────────────────────────────────────────

type Tone = "success" | "warning" | "muted";

interface CardData {
  icon: LucideIcon;
  title: string;
  tone: Tone;
  summary: string;
  kvs: Array<{ key: string; value: string }>;
}

const TONE_DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  muted:   "bg-foreground/30",
};

const TONE_ICON_BG: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  muted:   "bg-foreground/[0.06] text-foreground/55",
};

const TONE_BADGE: Record<Tone, LucideIcon> = {
  success: Check,
  warning: AlertTriangle,
  muted:   Minus,
};

function ConnectivityCard({ icon: Icon, title, tone, summary, kvs }: CardData) {
  const Badge = TONE_BADGE[tone];
  return (
    <Card
      isBlurred
      shadow="none"
      radius="md"
      className="
        bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10
        p-4 flex flex-col gap-3
      "
    >
      <div className="flex items-start gap-3">
        <span
          className={
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
            TONE_ICON_BG[tone]
          }
          aria-hidden
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[13.5px] font-medium text-foreground">{title}</h3>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-foreground/65">
            {summary}
          </p>
        </div>
        <Badge className="h-3.5 w-3.5 shrink-0 mt-0.5 text-foreground/40" strokeWidth={2.4} aria-hidden />
      </div>

      {kvs.length > 0 && (
        <dl className="flex flex-col gap-1.5 border-t border-foreground/[0.06] pt-3">
          {kvs.map(({ key, value }) => (
            <div key={key} className="flex items-baseline gap-2">
              <dt className="text-[11px] uppercase tracking-[0.04em] text-foreground/40 min-w-[54px]">
                {key}
              </dt>
              <dd
                className="truncate text-[12px] text-foreground/75 font-mono"
                title={value}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

// ─── Card composition ────────────────────────────────────────────────────────

function podCard(
  secrets: SecretsSummary | null,
  podInfo: PodInfo | null,
): CardData {
  // "Paired" means: pod URL is configured AND the agent API key is
  // present in secrets. We use the pod-info endpoint when available
  // (richer data) and fall back to the secrets summary so partial
  // loads still produce a useful card.
  const podUrl = podInfo?.podUrl ?? secrets?.synap.apiUrl ?? null;
  const apiKey = podInfo?.apiKeyPresent ?? secrets?.synap.hasApiKey ?? false;

  const paired = Boolean(podUrl) && apiKey;

  const tone: Tone = paired
    ? "success"
    : podUrl
      ? "warning"
      : "muted";

  const summary = paired
    ? "Paired and authenticated. Agents can reach the data pod."
    : podUrl
      ? "URL is set but no API key — provision the agent to authenticate."
      : "No pod paired yet — install Synap to enable the data pod.";

  const kvs: CardData["kvs"] = [];
  if (podUrl) kvs.push({ key: "URL", value: podUrl });
  if (podInfo?.version) kvs.push({ key: "Version", value: `v${podInfo.version}` });
  if (podInfo?.adminEmail) kvs.push({ key: "Admin", value: podInfo.adminEmail });

  return {
    icon: Database,
    title: "Pod",
    tone,
    summary,
    kvs,
  };
}

function cpCard(secrets: SecretsSummary | null): CardData {
  // The dashboard doesn't surface a structured "cp signed in" flag in
  // the secrets summary — what it does surface is the OAuth providers
  // configured under ai (proxy for AI providers, NOT CP). We use a
  // pragmatic proxy: messaging configured suggests CP-side wiring
  // happened, but the more direct signal is whether the OpenClaw key
  // synapApiKey was set up (post-CP-signin step). Fall back to
  // secrets.synap.hasApiKey since that's set during CP signin too.
  //
  // This isn't perfect — we'd need a dedicated "cp token" probe to be
  // certain. For now we report "configured" when the synap key is
  // present, "not signed in" when it's absent.
  const armed = secrets?.synap.hasApiKey === true;
  const tone: Tone = armed ? "success" : "muted";

  const summary = armed
    ? "CP credentials are stored — Eve can pull marketplace + entitlements."
    : "Not signed in to the control plane. Sign in from Home to unlock paid apps.";

  const kvs: CardData["kvs"] = [];
  if (secrets?.ai.defaultProvider) {
    kvs.push({ key: "AI", value: secrets.ai.defaultProvider });
  }
  const providerCount = secrets?.ai.providers.filter(p => p.hasKey).length ?? 0;
  if (providerCount > 0) {
    kvs.push({
      key: "Providers",
      value: `${providerCount} configured`,
    });
  }

  return {
    icon: Cloud,
    title: "Control plane",
    tone,
    summary,
    kvs,
  };
}

function domainCard(networking: NetworkingInfo | null): CardData {
  const primary = networking?.domain?.primary ?? null;
  const ssl = Boolean(networking?.domain?.ssl);
  const traefik = networking?.traefik.containerRunning ?? false;

  const tone: Tone =
    primary && traefik && ssl
      ? "success"
      : primary
        ? "warning"
        : "muted";

  const summary = primary
    ? traefik
      ? ssl
        ? "Domain configured with HTTPS routing live."
        : "Domain configured but running over HTTP — enable SSL for safety."
      : "Domain configured but Traefik is not running — services aren't routable."
    : "No domain configured. Services are reachable only by host port.";

  const kvs: CardData["kvs"] = [];
  if (primary) kvs.push({ key: "Domain", value: primary });
  kvs.push({ key: "SSL", value: ssl ? "enabled" : "disabled" });
  kvs.push({
    key: "Traefik",
    value: traefik ? "running" : "stopped",
  });

  return {
    icon: Globe,
    title: "Domain",
    tone,
    summary,
    kvs,
  };
}
