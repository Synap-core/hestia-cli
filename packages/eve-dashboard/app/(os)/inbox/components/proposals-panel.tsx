"use client";

/**
 * Inbox — Proposals panel.
 *
 * USER channel — talks to the pod via tRPC over `/api/pod/*`. The
 * service-channel `/api/hub/*` proxies are NOT used here; this is an
 * operator action (read inbox, approve / reject) so the user-channel
 * is required (see eve-credentials.mdx for the two-channel rule).
 *
 *   List:    GET  /api/pod/trpc/proposals.list?input={"json":{...}}
 *   Approve: POST /api/pod/trpc/proposals.approve  body {"json":{proposalId}}
 *   Reject:  POST /api/pod/trpc/proposals.reject   body {"json":{proposalId}}
 *
 * tRPC envelope: superjson-wrapped — request `{ json: <data> }`,
 * response `{ result: { data: { json: <data>, meta?: ... } } }`. We
 * unwrap once on the way back.
 *
 * Optimistic flow:
 *   1. Click Approve/Reject → row enters `working` state; buttons disable.
 *   2. RPC succeeds → row removed from local list + success toast.
 *   3. RPC fails  → row reverts to idle; danger toast; full refetch
 *                   so the list re-syncs against pod truth.
 *
 * The expandable payload preview ("Details") is intentionally low-key —
 * we render the JSON payload inside a small `<pre>` so power-users can
 * audit before approving without committing screen real estate to it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Chip, addToast } from "@heroui/react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Inbox as InboxIcon,
  Loader2,
  X,
} from "lucide-react";
import {
  buildFallbackTitle,
  resolveAuthorName,
  resolveTargetName,
} from "@synap-core/types";
import { PanelEmpty, PanelError, PanelLoader } from "./panel-states";

interface WireProposal {
  id: string;
  workspaceId: string | null;
  targetType: string;
  targetId: string;
  proposalType: string;
  data: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  agentUserId?: string | null;
  threadId?: string | null;
  sourceMessageId?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string | null;
  reviewedAt?: string | null;
  authorName?: string;
  targetName?: string;
  request?: {
    source:
      | "user"
      | "ai"
      | "system"
      | "intelligence"
      | "agent"
      | "openwebui-pipeline"
      | "openclaw"
      | "extension"
      | "cli"
      | "n8n"
      | "raycast";
    sourceId: string;
    targetType: string;
    targetId: string;
    targetName?: string;
    changeType: string;
    data?: Record<string, unknown>;
    reasoning?: string;
    summary?: string;
  };
}

type RowState = "idle" | "working";

// ─── tRPC envelope helpers ───────────────────────────────────────────────────

/**
 * Standard tRPC + superjson response envelope. The transformer wraps
 * the actual data inside `result.data.json`. We accept the unwrapped
 * shape too as a defensive fallback (some procedures emit raw payloads
 * when superjson finds nothing to serialize).
 */
interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } | T };
  error?: { message?: string };
}

function unwrapTrpc<T>(env: TrpcEnvelope<T> | null): T | null {
  if (!env) return null;
  const data = env.result?.data;
  if (data && typeof data === "object" && "json" in data) {
    return (data as { json?: T }).json ?? null;
  }
  return (data as T) ?? null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; proposals: WireProposal[] }
  | { kind: "error"; message: string };

export function ProposalsPanel() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  const fetchProposals = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const input = encodeURIComponent(
        JSON.stringify({ json: { status: "pending" } }),
      );
      const r = await fetch(`/api/pod/trpc/proposals.list?input=${input}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(
          txt && txt.length < 200 ? txt : `Pod returned ${r.status}`,
        );
      }
      const json = (await r.json().catch(() => null)) as TrpcEnvelope<
        | { proposals?: WireProposal[]; items?: WireProposal[] }
        | WireProposal[]
      > | null;
      // tRPC + superjson envelope: { result: { data: { json: <data> } } }
      const data = unwrapTrpc<
        { proposals?: WireProposal[]; items?: WireProposal[] } | WireProposal[]
      >(json);
      // The list procedure returns `{ proposals }` or `{ items }` — accept
      // either, and a bare array as a defensive fallback.
      const list: WireProposal[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.proposals)
          ? data.proposals
          : Array.isArray(data?.items)
            ? data.items
            : [];
      setLoad({ kind: "ready", proposals: list });
    } catch (err) {
      setLoad({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, []);

  useEffect(() => {
    void fetchProposals();
  }, [fetchProposals]);

  const handleResolve = useCallback(
    async (id: string, action: "approve" | "reject") => {
      setRowState((prev) => ({ ...prev, [id]: "working" }));
      try {
        // tRPC mutation: POST /trpc/proposals.{approve|reject}
        // body { json: { proposalId } } (superjson)
        const procedure =
          action === "approve" ? "proposals.approve" : "proposals.reject";
        const r = await fetch(`/api/pod/trpc/${procedure}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: { proposalId: id } }),
          cache: "no-store",
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(
            txt && txt.length < 200
              ? txt
              : `Pod returned ${r.status} for ${action}`,
          );
        }
        // Optimistic remove. We don't trust the upstream payload here —
        // the panel only displays pending rows, so anything not-pending
        // is gone from this view regardless of the precise response.
        setLoad((prev) => {
          if (prev.kind !== "ready") return prev;
          return {
            kind: "ready",
            proposals: prev.proposals.filter((p) => p.id !== id),
          };
        });
        addToast({
          title: action === "approve" ? "Approved" : "Rejected",
          color: action === "approve" ? "success" : "default",
        });
      } catch (err) {
        addToast({
          title: action === "approve" ? "Approve failed" : "Reject failed",
          description: err instanceof Error ? err.message : undefined,
          color: "danger",
        });
        // Re-sync — maybe someone else already resolved it.
        void fetchProposals();
      } finally {
        setRowState((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [fetchProposals],
  );

  if (load.kind === "loading") return <PanelLoader />;
  if (load.kind === "error") {
    return <PanelError message={load.message} onRetry={fetchProposals} />;
  }
  if (load.proposals.length === 0) {
    return (
      <PanelEmpty
        icon={InboxIcon}
        title="No pending proposals"
        hint="When AI agents or connectors propose changes, they’ll show up here for review."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {load.proposals.map((p) => (
        <ProposalRow
          key={p.id}
          proposal={p}
          state={rowState[p.id] ?? "idle"}
          onResolve={handleResolve}
        />
      ))}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ProposalRow({
  proposal,
  state,
  onResolve,
}: {
  proposal: WireProposal;
  state: RowState;
  onResolve: (id: string, action: "approve" | "reject") => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(() => proposalSummary(proposal), [proposal]);
  const agentLabel = useMemo(() => agentLabelFor(proposal), [proposal]);
  const initial = useMemo(() => authorInitial(proposal), [proposal]);
  const time = useMemo(
    () => relativeTime(proposal.createdAt ?? proposal.updatedAt),
    [proposal],
  );

  const isWorking = state === "working";
  const isPending = proposal.status === "pending";

  // Color for the status/author chip based on proposal state
  const chipColor = isPending
    ? "warning"
    : proposal.status === "approved"
      ? "success"
      : proposal.status === "rejected"
        ? "danger"
        : "default";

  return (
    <Card
      radius="md"
      shadow="none"
      className="
        flex flex-col gap-3 p-4
        bg-foreground/[0.04]
        ring-1 ring-inset ring-foreground/10
        transition-colors
      "
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Chip
              size="sm"
              variant="flat"
              radius="sm"
              color={chipColor}
              className="h-5 px-1.5 text-[10.5px] font-medium uppercase tracking-[0.04em]"
            >
              {isPending
                ? "Pending"
                : proposal.status === "approved"
                  ? "Approved"
                  : proposal.status === "rejected"
                    ? "Rejected"
                    : proposal.status}
            </Chip>
            <span className="text-[11px] text-foreground/45">
              {proposal.targetType}
            </span>
            {time && (
              <>
                <span className="text-foreground/30">·</span>
                <span className="text-[11px] text-foreground/45">{time}</span>
              </>
            )}
          </div>
          <h3 className="mt-1 truncate text-[14px] font-medium text-foreground">
            {summary.title}
          </h3>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-foreground/65">
            {summary.body}
          </p>
          {agentLabel && (
            <div className="mt-1 flex items-center gap-1.5">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary shrink-0">
                {initial}
              </div>
              <span className="text-[11px] text-foreground/65">
                {agentLabel}
                {proposal.request?.reasoning && (
                  <span className="ml-1 text-[10px] text-foreground/40">
                    · AI reasoning available
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="
            inline-flex items-center gap-1
            text-[11.5px] text-foreground/55 hover:text-foreground/85
            transition-colors
          "
          aria-expanded={expanded}
          aria-label={expanded ? "Hide payload" : "Show payload"}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" strokeWidth={2.2} />
          ) : (
            <ChevronRight className="h-3 w-3" strokeWidth={2.2} />
          )}
          {expanded ? "Hide details" : "Show details"}
        </button>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            radius="full"
            variant="flat"
            color="danger"
            isDisabled={isWorking}
            startContent={
              isWorking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )
            }
            onPress={() => onResolve(proposal.id, "reject")}
            aria-label={`Reject proposal ${proposal.id}`}
          >
            Reject
          </Button>
          <Button
            size="sm"
            radius="full"
            variant="flat"
            color="success"
            isDisabled={isWorking}
            startContent={
              isWorking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )
            }
            onPress={() => onResolve(proposal.id, "approve")}
            aria-label={`Approve proposal ${proposal.id}`}
          >
            Approve
          </Button>
        </div>
      </div>

      {expanded && (
        <pre
          className="
            max-h-64 overflow-auto rounded-lg
            bg-foreground/[0.05]
            ring-1 ring-inset ring-foreground/10
            px-3 py-2
            text-[11px] leading-snug text-foreground/75
            font-mono
          "
        >
          {safeStringify(proposal.data)}
        </pre>
      )}
    </Card>
  );
}

// ─── Summarisers ─────────────────────────────────────────────────────────────

interface ProposalSummary {
  title: string;
  body: string;
}

/**
 * Best-effort one-line summary derived from the proposal payload.
 * Uses shared {@link resolveTargetName} and the enriched `request` field
 * from the backend rather than raw IDs.
 */
function proposalSummary(p: WireProposal): ProposalSummary {
  // Prefer explicit summary from agent or backend
  const data = p.data ?? {};
  const explicit =
    typeof p.request?.summary === "string"
      ? p.request.summary
      : typeof data._summary === "string"
      ? data._summary
      : typeof data.summary === "string"
        ? data.summary
        : null;

  const request = p.request;
  const entityPayload =
    request?.data && typeof request.data === "object"
      ? request.data
      : data.data && typeof data.data === "object"
        ? (data.data as Record<string, unknown>)
        : undefined;

  const resolvedTargetName = resolveTargetName({
    targetName: request?.targetName ?? p.targetName,
    targetType: request?.targetType || p.targetType,
    targetId: request?.targetId || p.targetId,
    entityPayload,
  });
  const targetName = looksLikeIdFallback(
    resolvedTargetName,
    request?.targetId || p.targetId,
  )
    ? request?.targetName ?? p.targetName
    : resolvedTargetName;

  const profileSlug =
    entityPayload &&
    ((typeof entityPayload.profileSlug === "string" && entityPayload.profileSlug) ||
      (typeof entityPayload.type === "string" && entityPayload.type));
  const targetKind = profileSlug || request?.targetType || p.targetType;
  const changeDescription = describePayloadChange(entityPayload);

  if (explicit) {
    return {
      title: explicit,
      body: compactSentence([
        request ? prettyAction(request.changeType) : prettyAction(p.proposalType),
        targetName ? `on ${targetName}` : undefined,
        changeDescription,
      ]),
    };
  }

  // Common shape: { name?, title?, description? } — use whichever is present.
  const name =
    (typeof data.name === "string" && data.name) ||
    (typeof data.title === "string" && data.title) ||
    null;
  const description =
    (typeof data.description === "string" && data.description) || null;
  const changeType = request?.changeType ?? p.proposalType;

  if (name) {
    return {
      title: `${prettyAction(changeType)}: ${name}`,
      body: compactSentence([description, changeDescription, targetKind]),
    };
  }

  return {
    title: buildFallbackTitle({
      changeType,
      profileSlug: profileSlug || undefined,
      targetType: request?.targetType ?? p.targetType,
      targetName: targetName || undefined,
    }),
    body: compactSentence([changeDescription, targetName, targetKind]),
  };
}

function prettyAction(proposalType: string): string {
  // entity.create → "Create entity"; view.update → "Update view".
  // Falls back to the raw string when we don't recognise the shape.
  const m = /^([a-z_]+)\.([a-z_]+)$/.exec(proposalType);
  if (!m) return capitalize(proposalType.replace(/[._]/g, " "));
  const target = m[1].replace(/_/g, " ");
  const verb = m[2].replace(/_/g, " ");
  return `${capitalize(verb)} ${target}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function agentLabelFor(p: WireProposal): string | null {
  return resolveAuthorName({
    authorName: p.authorName ?? undefined,
    source: p.request?.source,
    sourceId: p.request?.sourceId ?? p.agentUserId ?? undefined,
  });
}

/**
 * Extract the author's display name from the enriched request.
 * This is the single place author resolution happens — no per-row fetches needed.
 */
function authorInitial(p: WireProposal): string {
  const name = agentLabelFor(p);
  return name ? name.trim().charAt(0).toUpperCase() : "?";
}

function relativeTime(ts: string | undefined): string | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function describePayloadChange(
  payload: Record<string, unknown> | undefined,
): string | undefined {
  if (!payload) return undefined;
  const fields: string[] = [];
  if (typeof payload.title === "string") fields.push("title");
  if (typeof payload.description === "string") fields.push("description");
  if (typeof payload.profileSlug === "string") fields.push("type");

  const properties =
    payload.properties && typeof payload.properties === "object"
      ? Object.keys(payload.properties as Record<string, unknown>)
      : [];
  if (properties.length > 0) {
    fields.push(
      properties.length === 1
        ? `property ${properties[0]}`
        : `${properties.length} properties: ${properties.slice(0, 3).join(", ")}${
            properties.length > 3 ? "…" : ""
          }`,
    );
  }

  if (fields.length === 0) return undefined;
  return `Changes ${fields.join(", ")}`;
}

function compactSentence(parts: Array<string | undefined | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function looksLikeIdFallback(label: string, id: string | undefined): boolean {
  if (!id) return false;
  return label.includes(id.slice(0, 8));
}
