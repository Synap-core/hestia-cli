"use client";

/**
 * Open WebUI configuration panel.
 *
 * Open WebUI runs as a generic chat UI with no native Synap awareness —
 * we wire it up via env (`OPENAI_API_BASE_URL[S]` → Synap IS as the
 * OpenAI-compat hub) and via the Pipelines sidecar (memory injection,
 * channel sync, slash dispatch).
 *
 * The panel surfaces two things the user actually needs to know:
 *   1. Where to open it (URL + first-time setup guidance).
 *   2. Whether the Synap wiring is working end-to-end (integration
 *      checklist — calls /api/doctor with `integrationId="openwebui-synap"`,
 *      includes a real `/v1/models` probe inside the container).
 *
 * No daemon settings or per-component config here yet — when the user
 * needs to override env, they edit `/opt/openwebui/.env` directly. The
 * compose YAML is regenerated on every update so manual YAML edits
 * would be lost; we surface that warning explicitly.
 */

import { useEffect, useState } from "react";
import {
  Spinner, Chip, Accordion, AccordionItem,
} from "@heroui/react";
import {
  ExternalLink, MessagesSquare, BookOpen, Wand2, Zap,
} from "lucide-react";
import { IntegrationChecklist } from "../integration-checklist";

interface ComponentDetail {
  id: string;
  installed: boolean;
  containerRunning: boolean | null;
  domainUrl: string | null;
  hostPort: number | null;
}

interface SecretsSummary {
  synap?: { configured: boolean; hasApiKey: boolean; apiUrl?: string };
}

export function OpenwebuiConfigPanel() {
  const [detail, setDetail] = useState<ComponentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [synapUrl, setSynapUrl] = useState<string | null>(null);

  useEffect(() => {
    // Fetch components + secrets summary in parallel — both are read-only
    // and we need the Synap pod URL for the Hub Protocol feature links.
    void (async () => {
      try {
        const [compRes, summaryRes] = await Promise.all([
          fetch("/api/components", { credentials: "include" }),
          fetch("/api/secrets-summary", { credentials: "include" }),
        ]);
        if (compRes.ok) {
          const data = await compRes.json() as { components: ComponentDetail[] };
          setDetail(data.components.find(c => c.id === "openwebui") ?? null);
        }
        if (summaryRes.ok) {
          const summary = await summaryRes.json() as SecretsSummary;
          const url = summary.synap?.apiUrl;
          if (url) setSynapUrl(url.replace(/\/+$/, ""));
        }
      } finally { setLoading(false); }
    })();
  }, []);

  // Build the URL the user should open. Prefer the configured domain
  // (chat.<domain>) over the host port; fall back to localhost as a
  // last resort.
  const url = detail?.domainUrl
    ?? (detail?.hostPort ? `http://localhost:${detail.hostPort}` : null);

  return (
    <div className="space-y-4">
      {/* Open-in-browser card */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <MessagesSquare className="h-3.5 w-3.5" />
          <span>Chat URL</span>
        </div>
        {loading ? (
          <Spinner size="sm" />
        ) : detail?.containerRunning && url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-3 rounded-md border border-divider bg-content1 px-3 py-2.5 hover:border-primary/40 hover:bg-primary/5 transition-colors"
          >
            <div className="min-w-0">
              <p className="font-mono text-sm text-foreground truncate">{url}</p>
              <p className="text-xs text-default-500 mt-0.5">Open Eve chat in a new tab</p>
            </div>
            <ExternalLink className="h-4 w-4 text-default-400 group-hover:text-primary shrink-0" />
          </a>
        ) : (
          <p className="text-sm text-default-500">
            {detail?.installed
              ? "Container not running — start it from the actions row."
              : "Open WebUI is not installed."}
          </p>
        )}
      </div>

      {/* Synap wiring health — same checklist surface as Hermes/OpenClaw */}
      <IntegrationChecklist
        integrationId="openwebui-synap"
        title="Open WebUI ↔ Synap"
        description="What Open WebUI needs to actually show your provider's models in the picker."
      />
      <IntegrationChecklist
        integrationId="openwebui-pipelines"
        title="Pipelines (memory + channel sync)"
        description="Pre-prompt context, chat-to-channel mirroring, slash command dispatch."
      />

      {/* First-time setup guidance */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3 text-sm text-default-700 leading-relaxed">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <BookOpen className="h-3.5 w-3.5" />
          <span>First time?</span>
        </div>
        <ol className="space-y-2 list-decimal pl-5 text-default-700">
          <li>
            Open the chat URL above. Sign up — the <em>first</em> account is
            automatically the admin. Subsequent signups are
            <Chip size="sm" variant="flat" radius="sm" className="mx-1.5">pending</Chip>
            and need admin approval.
          </li>
          <li>
            Models from your providers (configured on the AI page) show up
            automatically in the model picker. If they don&apos;t, the
            integration checklist above will tell you why.
          </li>
          <li>
            Pipelines (memory injection, channel sync, /scaffold dispatch)
            are wired as additional models from the sidecar — pick one of
            them in chat to opt into that flow.
          </li>
        </ol>
      </div>

      {/* Architectural note — explains why "Anthropic" isn't a tab */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-2 text-sm text-default-700 leading-relaxed">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <Wand2 className="h-3.5 w-3.5" />
          <span>Why don&apos;t I see &quot;Anthropic&quot; or &quot;OpenAI&quot; tabs?</span>
        </div>
        <p>
          Open WebUI sees one OpenAI-compatible backend: Synap IS. The
          providers you add on the AI page (Anthropic, OpenAI,
          OpenRouter…) live <em>inside</em> Synap IS — it returns their
          models from <code className="font-mono text-xs">/v1/models</code>.
          So you&apos;ll see model names like
          {" "}<code className="font-mono text-xs">claude-sonnet-4-7</code>,{" "}
          <code className="font-mono text-xs">gpt-5</code>, or
          {" "}<code className="font-mono text-xs">synap/auto</code>{" "}in
          the picker — not provider tabs.
        </p>
      </div>

      {/* Hub Protocol features — surfaces capabilities the pod just gained
          so users discover them without reading release notes. Compact:
          one-line per feature + a collapsible "details" accordion below. */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <Zap className="h-3.5 w-3.5" />
          <span>Hub Protocol features</span>
        </div>
        <ul className="space-y-1.5 text-sm text-default-700">
          <li>
            <span className="font-medium text-foreground">Idempotency-Key</span>
            {" "}— pipelines automatically benefit from retry safety on POSTs.
          </li>
          <li>
            <span className="font-medium text-foreground">OpenAPI spec</span>
            {" "}—{" "}
            {synapUrl ? (
              <>
                <a
                  href={`${synapUrl}/api/hub/openapi.json`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-primary hover:underline"
                >
                  /api/hub/openapi.json
                </a>
                {" "}(machine-readable);{" "}
                <a
                  href={`${synapUrl}/api/hub/docs`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-primary hover:underline"
                >
                  /api/hub/docs
                </a>
                {" "}(Swagger UI on dev pods).
              </>
            ) : (
              <span className="text-default-500">
                <code className="font-mono text-xs">/api/hub/openapi.json</code>
                {" "}+ Swagger UI at <code className="font-mono text-xs">/api/hub/docs</code>
                {" "}(configure Synap pod URL to get direct links).
              </span>
            )}
          </li>
          <li>
            <span className="font-medium text-foreground">Per-user sub-tokens</span>
            {" "}— route writes to per-human Synap users in shared OWUI installs (opt-in,{" "}
            <code className="font-mono text-xs">HUB_PROTOCOL_SUB_TOKENS=true</code>).
          </li>
          <li>
            <span className="font-medium text-foreground">Live event stream</span>
            {" "}—{" "}
            {synapUrl ? (
              <a
                href={`${synapUrl}/api/hub/events/stream`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-primary hover:underline"
              >
                /api/hub/events/stream
              </a>
            ) : (
              <code className="font-mono text-xs">/api/hub/events/stream</code>
            )}
            {" "}for SSE consumers (live entity / channel updates).
          </li>
        </ul>
        <Accordion isCompact className="px-0">
          <AccordionItem
            key="sub-tokens"
            aria-label="Per-user sub-token modes"
            title={<span className="text-xs text-default-500">How per-user sub-tokens work</span>}
            classNames={{ title: "text-xs", content: "text-xs text-default-600 leading-relaxed" }}
          >
            <p>
              <span className="font-medium text-foreground">Mode 1 — header remap.</span>{" "}
              Keep the parent agent key as Bearer; add{" "}
              <code className="font-mono">X-External-User-Id: &lt;owui-user&gt;</code>{" "}
              per request. The pod looks up the mapping and routes the
              write to the right human. Simplest setup, no token rotation.
            </p>
            <p className="mt-2">
              <span className="font-medium text-foreground">Mode 2 — pre-minted child tokens.</span>{" "}
              Call <code className="font-mono">POST /api/hub/setup/external-user</code>{" "}
              with <code className="font-mono">mintSubToken: true</code> once per user;
              persist the returned <code className="font-mono">subToken</code> and use it as
              Bearer on subsequent requests. Good for callers that can&apos;t reliably
              forward a header per-request.
            </p>
            <p className="mt-2 text-default-500">
              The shipped pipelines support Mode 1 via the{" "}
              <code className="font-mono">PER_USER_TOKENS</code> valve (off by default —
              enabling it without the matching pod env is a no-op).
            </p>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Edit warning — don't lose user config */}
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm space-y-1">
        <p className="font-medium text-foreground">Customizing Open WebUI?</p>
        <p className="text-default-500">
          Edit <code className="font-mono text-xs">/opt/openwebui/.env</code>
          {" "}— it survives every install and update. The
          <code className="font-mono text-xs"> docker-compose.yml</code> in the same
          directory is regenerated on every update, so don&apos;t edit it
          directly. Need a structural override? Add a sibling
          <code className="font-mono text-xs"> docker-compose.override.yml</code>.
        </p>
      </div>
    </div>
  );
}
