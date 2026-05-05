"use client";

/**
 * Settings → Members
 *
 * Two-channel rule: this page is operator-driven, so every pod call
 * goes through `/api/pod/trpc/*` (USER channel), never `/api/hub/*`.
 *
 *   • List:    GET  /api/pod/trpc/workspaces.list                (roster)
 *              GET  /api/pod/trpc/workspaces.listMembers         (per-ws)
 *   • Invite:  POST /api/pod/trpc/workspaces.createInvite
 *
 * Roster simplification: the pod has no pod-wide `listPodMembers`
 * procedure yet. We render the first workspace's members as a stand-in;
 * for solo pods this matches the reality of the system. Multi-workspace
 * pods get a TODO surfaced in the page header.
 *
 * The invite-link surface stays in this Eve UI — the pod doesn't email
 * invites yet, so the admin copies the URL and shares it manually.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §6
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Input,
  Select,
  SelectItem,
  Spinner,
  addToast,
} from "@heroui/react";
import {
  Users,
  Mail,
  Send,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";

// ─── tRPC envelope helpers ───────────────────────────────────────────

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

// ─── Wire types (subset of pod responses) ─────────────────────────────

interface WireWorkspace {
  id: string;
  name: string;
  role?: string;
}

interface WireMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  joinedAt?: string | null;
  user?: {
    id: string;
    email?: string | null;
    name?: string | null;
  } | null;
}

interface CreateInviteResult {
  id: string;
  token: string;
  expiresAt: string;
}

type Role = "admin" | "editor" | "viewer";
type InviteType = "pod" | "workspace";

type RosterState =
  | { kind: "loading" }
  | {
      kind: "ready";
      workspaceName: string;
      members: WireMember[];
      additionalWorkspaces: number;
    }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

interface InviteResult {
  url: string;
  email: string;
  expiresAt: string;
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function MembersPage() {
  const [roster, setRoster] = useState<RosterState>({ kind: "loading" });

  // Invite form state.
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [inviteType, setInviteType] = useState<InviteType>("pod");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchRoster = useCallback(async () => {
    setRoster({ kind: "loading" });
    try {
      // 1. List workspaces the operator belongs to.
      const wsInput = encodeURIComponent(JSON.stringify({ json: {} }));
      const wsRes = await fetch(
        `/api/pod/trpc/workspaces.list?input=${wsInput}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!wsRes.ok) {
        const txt = await wsRes.text().catch(() => "");
        throw new Error(
          txt && txt.length < 200
            ? txt
            : `Pod returned ${wsRes.status}`,
        );
      }
      const wsJson = (await wsRes.json().catch(
        () => null,
      )) as TrpcEnvelope<WireWorkspace[]> | null;
      const workspaces = unwrapTrpc<WireWorkspace[]>(wsJson) ?? [];
      if (workspaces.length === 0) {
        setRoster({
          kind: "empty",
          message:
            "You don't belong to any workspaces yet. Create one first.",
        });
        return;
      }

      // 2. List members of the first workspace.
      // TODO(roster): the pod has no `workspaces.listAllMembers`
      // procedure that aggregates members across workspaces. For now
      // we render the first workspace and surface a count of the rest
      // so multi-workspace pods know what they're seeing.
      const first = workspaces[0];
      const memberInput = encodeURIComponent(
        JSON.stringify({ json: { workspaceId: first.id } }),
      );
      const memberRes = await fetch(
        `/api/pod/trpc/workspaces.listMembers?input=${memberInput}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!memberRes.ok) {
        const txt = await memberRes.text().catch(() => "");
        throw new Error(
          txt && txt.length < 200
            ? txt
            : `Pod returned ${memberRes.status}`,
        );
      }
      const memberJson = (await memberRes.json().catch(
        () => null,
      )) as TrpcEnvelope<WireMember[]> | null;
      const members = unwrapTrpc<WireMember[]>(memberJson) ?? [];
      setRoster({
        kind: "ready",
        workspaceName: first.name,
        members,
        additionalWorkspaces: Math.max(0, workspaces.length - 1),
      });
    } catch (err) {
      setRoster({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to load members.",
      });
    }
  }, []);

  useEffect(() => {
    void fetchRoster();
  }, [fetchRoster]);

  const trimmedEmail = email.trim().toLowerCase();
  const emailLooksValid = useMemo(
    () =>
      trimmedEmail.length === 0 ||
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail),
    [trimmedEmail],
  );

  async function handleInvite() {
    setFormError(null);
    setResult(null);
    if (!trimmedEmail || !emailLooksValid) {
      setFormError("Enter a valid email address.");
      return;
    }
    if (inviteType === "workspace") {
      // Workspace-scoped invites need a workspace picker — out of scope
      // for the first cut. Block at the form level.
      setFormError(
        "Workspace-scoped invites aren't wired yet. Use a pod invite for now.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/pod/trpc/workspaces.createInvite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: { type: inviteType, email: trimmedEmail, role },
        }),
        cache: "no-store",
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(
          txt && txt.length < 200
            ? txt
            : `Pod returned ${r.status}`,
        );
      }
      const json = (await r.json().catch(
        () => null,
      )) as TrpcEnvelope<CreateInviteResult> | null;
      const data = unwrapTrpc<CreateInviteResult>(json);
      if (!data?.token) {
        throw new Error("Pod did not return a token.");
      }
      const url = `${window.location.origin}/invite/${data.token}`;
      setResult({
        url,
        email: trimmedEmail,
        expiresAt: data.expiresAt,
      });
      setEmail("");
      addToast({ title: "Invite created", color: "success" });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create invite.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      addToast({ title: "Link copied", color: "success" });
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      addToast({ title: "Couldn't copy", color: "danger" });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <p className="text-sm font-medium text-foreground/55">Pod members</p>
        <h1 className="mt-1 font-heading text-3xl font-medium tracking-tight text-foreground">
          Members
        </h1>
        <p className="mt-1 max-w-2xl text-foreground/65">
          People who have access to this pod.
        </p>
      </header>

      {/* Roster */}
      <Card
        isBlurred
        shadow="none"
        radius="md"
        className="bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-foreground/55" strokeWidth={2} />
            <p className="text-[13px] font-medium text-foreground">
              {roster.kind === "ready"
                ? `Members of ${roster.workspaceName}`
                : "Members"}
            </p>
          </div>
          {roster.kind === "ready" && (
            <Chip size="sm" variant="flat" radius="sm">
              {roster.members.length}
            </Chip>
          )}
        </div>
        <div className="border-t border-foreground/[0.06]" />
        <div className="px-5 py-4">
          {roster.kind === "loading" && (
            <div className="flex items-center gap-3 text-[13px] text-foreground/55">
              <Spinner size="sm" color="primary" />
              <span>Loading members…</span>
            </div>
          )}
          {roster.kind === "error" && (
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                strokeWidth={2.2}
              />
              <p className="text-[12.5px] leading-snug text-foreground/65">
                {roster.message}
              </p>
            </div>
          )}
          {roster.kind === "empty" && (
            <p className="text-[13px] text-foreground/55">{roster.message}</p>
          )}
          {roster.kind === "ready" && (
            <>
              <ul className="flex flex-col gap-1">
                {roster.members.map((m) => (
                  <MemberRow key={m.id} member={m} />
                ))}
                {roster.members.length === 0 && (
                  <p className="text-[13px] text-foreground/55">
                    No members in this workspace yet.
                  </p>
                )}
              </ul>
              {roster.additionalWorkspaces > 0 && (
                <p className="mt-3 text-[12px] leading-snug text-foreground/55">
                  {roster.additionalWorkspaces} additional workspace
                  {roster.additionalWorkspaces === 1 ? "" : "s"} on this pod.
                  Cross-workspace roster aggregation is on the roadmap.
                </p>
              )}
            </>
          )}
        </div>
      </Card>

      {/* Invite form */}
      <Card
        isBlurred
        shadow="none"
        radius="md"
        className="bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10"
      >
        <div className="flex items-center gap-2 px-5 py-4">
          <Mail className="h-4 w-4 text-foreground/55" strokeWidth={2} />
          <p className="text-[13px] font-medium text-foreground">
            Invite teammate
          </p>
        </div>
        <div className="border-t border-foreground/[0.06]" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitting) void handleInvite();
          }}
          className="flex flex-col gap-3 px-5 py-4"
          noValidate
        >
          <Input
            type="email"
            size="md"
            radius="md"
            variant="flat"
            label="Email"
            labelPlacement="outside"
            placeholder="teammate@domain.com"
            value={email}
            onValueChange={setEmail}
            autoComplete="email"
            isRequired
            isInvalid={!emailLooksValid && email.length > 0}
            errorMessage={
              !emailLooksValid && email.length > 0
                ? "Enter a valid email address."
                : undefined
            }
            spellCheck="false"
            isDisabled={submitting}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              size="md"
              radius="md"
              variant="flat"
              label="Role"
              labelPlacement="outside"
              selectedKeys={[role]}
              onSelectionChange={(keys) => {
                const next = String(Array.from(keys)[0] ?? "editor");
                if (
                  next === "admin" ||
                  next === "editor" ||
                  next === "viewer"
                ) {
                  setRole(next);
                }
              }}
              isDisabled={submitting}
            >
              <SelectItem key="admin">Admin</SelectItem>
              <SelectItem key="editor">Editor</SelectItem>
              <SelectItem key="viewer">Viewer</SelectItem>
            </Select>

            <Select
              size="md"
              radius="md"
              variant="flat"
              label="Invite type"
              labelPlacement="outside"
              selectedKeys={[inviteType]}
              onSelectionChange={(keys) => {
                const next = String(Array.from(keys)[0] ?? "pod");
                if (next === "pod" || next === "workspace") {
                  setInviteType(next);
                }
              }}
              isDisabled={submitting}
              description={
                inviteType === "pod"
                  ? "Adds them to every workspace on the pod."
                  : "Workspace picker not wired yet."
              }
            >
              <SelectItem key="pod">Pod (all workspaces)</SelectItem>
              <SelectItem key="workspace">Single workspace</SelectItem>
            </Select>
          </div>

          {formError && (
            <div
              role="alert"
              className="
                flex items-start gap-2
                rounded-lg
                bg-warning/10 ring-1 ring-inset ring-warning/30
                px-3 py-2
              "
            >
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                strokeWidth={2.2}
                aria-hidden
              />
              <p className="text-[12.5px] leading-snug text-foreground">
                {formError}
              </p>
            </div>
          )}

          <div className="mt-1 flex justify-end">
            <Button
              type="submit"
              color="primary"
              size="md"
              radius="md"
              isLoading={submitting}
              isDisabled={
                submitting ||
                trimmedEmail.length === 0 ||
                !emailLooksValid
              }
              startContent={
                submitting ? undefined : <Send className="h-3.5 w-3.5" />
              }
              className="font-medium"
            >
              Send invite
            </Button>
          </div>
        </form>
      </Card>

      {/* Invite result */}
      {result && (
        <Card
          isBlurred
          shadow="none"
          radius="md"
          className="bg-success/[0.06] ring-1 ring-inset ring-success/30"
        >
          <div className="flex flex-col gap-3 px-5 py-4">
            <div className="flex items-start gap-3">
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-success"
                strokeWidth={2.2}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground">
                  Invite created for{" "}
                  <span className="text-foreground">{result.email}</span>
                </p>
                <p className="mt-0.5 text-[12.5px] text-foreground/65">
                  Share this link with them — Eve doesn&apos;t email
                  invites yet.
                </p>
              </div>
            </div>
            <div className="flex items-stretch gap-2">
              <pre
                className="
                  min-w-0 flex-1 overflow-x-auto
                  rounded-md
                  bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10
                  px-3 py-2
                  font-mono text-[12.5px] leading-snug text-foreground
                "
              >
                {result.url}
              </pre>
              <Button
                isIconOnly
                variant="flat"
                size="sm"
                radius="md"
                aria-label="Copy invite link"
                onPress={() => void handleCopy()}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            <p className="text-[12px] leading-snug text-foreground/55">
              Expires{" "}
              {new Date(result.expiresAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              .
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Member row ──────────────────────────────────────────────────────

function MemberRow({ member }: { member: WireMember }) {
  const name =
    member.user?.name?.trim() ||
    member.user?.email?.split("@")[0] ||
    "Member";
  const email = member.user?.email ?? "—";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "?";

  return (
    <li
      className="
        flex items-center gap-3
        rounded-lg
        px-3 py-2.5
        hover:bg-foreground/[0.03]
        transition-colors
      "
    >
      <span
        aria-hidden
        className="
          flex h-9 w-9 shrink-0 items-center justify-center
          rounded-full
          bg-primary/10
          ring-1 ring-inset ring-primary/20
          font-mono text-[13px] font-medium text-primary
        "
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">
          {name}
        </p>
        <p className="truncate text-[12px] text-foreground/55">{email}</p>
      </div>
      <Chip
        size="sm"
        variant="flat"
        radius="sm"
        className="shrink-0 capitalize"
      >
        {member.role}
      </Chip>
      {member.joinedAt && (
        <span className="hidden shrink-0 text-[11.5px] text-foreground/40 sm:inline-block">
          joined{" "}
          {new Date(member.joinedAt).toLocaleDateString(undefined, {
            dateStyle: "medium",
          })}
        </span>
      )}
    </li>
  );
}
