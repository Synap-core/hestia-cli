"use client";

/**
 * Settings → Members
 *
 * Two-channel rule: this page is operator-driven, so every pod call
 * goes through `/api/pod/trpc/*` (USER channel), never `/api/hub/*`.
 *
 *   • Identity:    GET  /api/pod/trpc/users.me
 *   • Roster:      GET  /api/pod/trpc/workspaces.listPodMembers
 *                       (pod-wide, deduplicated by user, +primaryRole)
 *   • Invites:     GET  /api/pod/trpc/workspaces.listAllInvites
 *                  POST /api/pod/trpc/workspaces.createInvite
 *                  POST /api/pod/trpc/workspaces.revokeInvite (= cancel)
 *   • Member ops:  POST /api/pod/trpc/workspaces.updateMemberRole (per-ws)
 *                  POST /api/pod/trpc/workspaces.removeFromPod (pod-wide)
 *
 * Pod-wide aggregation: `listPodMembers` returns a deduplicated roster
 * with the highest role per user across the operator's accessible
 * workspaces, plus the per-workspace memberships so we can render the
 * "+ N more workspaces" affordance.
 *
 * "Remove from pod" calls a single backend procedure that strips the
 * target from every workspace the operator can manage. The backend
 * enforces self-removal and last-owner guards.
 *
 * See: synap-team-docs/content/team/platform/eve-credentials.mdx §6
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  addToast,
} from "@heroui/react";
import {
  AlertTriangle,
  Check,
  Copy,
  Mail,
  MoreHorizontal,
  Send,
  ShieldAlert,
  Trash2,
  UserCog,
  UserMinus,
  Users,
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

async function podGet<T>(procedure: string, input: unknown = {}): Promise<T> {
  const enc = encodeURIComponent(JSON.stringify({ json: input }));
  const r = await fetch(`/api/pod/trpc/${procedure}?input=${enc}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(
      txt && txt.length < 200 ? txt : `Pod returned ${r.status}`,
    );
  }
  const env = (await r.json().catch(() => null)) as TrpcEnvelope<T> | null;
  if (env?.error?.message) throw new Error(env.error.message);
  const data = unwrapTrpc<T>(env);
  if (data === null || data === undefined) {
    throw new Error("Empty pod response");
  }
  return data;
}

async function podMutate<T>(procedure: string, input: unknown): Promise<T> {
  const r = await fetch(`/api/pod/trpc/${procedure}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
    cache: "no-store",
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(
      txt && txt.length < 200 ? txt : `Pod returned ${r.status}`,
    );
  }
  const env = (await r.json().catch(() => null)) as TrpcEnvelope<T> | null;
  if (env?.error?.message) throw new Error(env.error.message);
  return (unwrapTrpc<T>(env) ?? ({} as T)) as T;
}

// ─── Wire types ──────────────────────────────────────────────────────

type Role = "owner" | "admin" | "editor" | "viewer";
type EditableRole = "admin" | "editor" | "viewer";
type InviteType = "pod" | "workspace";

interface WireMe {
  id: string;
  email: string;
  name: string | null;
}

interface WireWorkspace {
  id: string;
  name: string;
  role?: string;
}

interface WirePodMember {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  primaryRole: Role;
  workspaceCount: number;
  workspaces: Array<{
    id: string;
    name: string;
    role: Role;
    joinedAt: string;
  }>;
}

interface WireInvite {
  id: string;
  type: InviteType;
  email: string;
  role: EditableRole;
  token: string;
  workspaceId: string | null;
  workspaceName: string | null;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}

interface CreateInviteResult {
  id: string;
  token: string;
  expiresAt: string;
}

// ─── Page ────────────────────────────────────────────────────────────

export default function MembersPage() {
  const [me, setMe] = useState<WireMe | null>(null);
  const [workspaces, setWorkspaces] = useState<WireWorkspace[]>([]);
  const [members, setMembers] = useState<WirePodMember[]>([]);
  const [invites, setInvites] = useState<WireInvite[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Invite form state.
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<EditableRole>("editor");
  const [inviteType, setInviteType] = useState<InviteType>("pod");
  const [inviteWorkspaceId, setInviteWorkspaceId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Modal state for "remove from pod" confirmation.
  const [removeTarget, setRemoveTarget] = useState<WirePodMember | null>(null);
  const [removing, setRemoving] = useState(false);

  // Per-row mutation pending state — keyed by user id.
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  // Per-invite pending state — keyed by invite id.
  const [pendingInviteId, setPendingInviteId] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [meData, wsData, memData, inviteData] = await Promise.all([
        podGet<WireMe>("users.me"),
        podGet<WireWorkspace[]>("workspaces.list"),
        podGet<WirePodMember[]>("workspaces.listPodMembers"),
        podGet<WireInvite[]>("workspaces.listAllInvites"),
      ]);
      setMe(meData);
      setWorkspaces(wsData);
      setMembers(memData);
      setInvites(inviteData);
      // Default the workspace-invite picker to the first workspace
      // when we have one.
      if (wsData.length > 0 && !inviteWorkspaceId) {
        setInviteWorkspaceId(wsData[0].id);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load members.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [inviteWorkspaceId]);

  useEffect(() => {
    void load();
    // We deliberately run once on mount; refetch via explicit calls
    // below after mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Invite form ──────────────────────────────────────────────────

  const trimmedEmail = email.trim().toLowerCase();
  const emailLooksValid = useMemo(
    () =>
      trimmedEmail.length === 0 ||
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail),
    [trimmedEmail],
  );

  async function handleInvite() {
    setFormError(null);
    if (!trimmedEmail || !emailLooksValid) {
      setFormError("Enter a valid email address.");
      return;
    }
    if (inviteType === "workspace" && !inviteWorkspaceId) {
      setFormError("Pick a workspace for the invite.");
      return;
    }
    setSubmitting(true);
    try {
      const payload =
        inviteType === "workspace"
          ? {
              type: "workspace" as const,
              workspaceId: inviteWorkspaceId,
              email: trimmedEmail,
              role,
            }
          : { type: "pod" as const, email: trimmedEmail, role };
      const created = await podMutate<CreateInviteResult>(
        "workspaces.createInvite",
        payload,
      );
      // Optimistic insert at the top of the pending list. Mostly
      // cosmetic — listAllInvites will return the same row on next
      // load — but the snappy UX is worth the few lines.
      const optimistic: WireInvite = {
        id: created.id,
        type: inviteType,
        email: trimmedEmail,
        role,
        token: created.token,
        workspaceId:
          inviteType === "workspace" ? inviteWorkspaceId : null,
        workspaceName:
          inviteType === "workspace"
            ? workspaces.find((w) => w.id === inviteWorkspaceId)?.name ?? null
            : null,
        invitedBy: me?.id ?? "",
        expiresAt: created.expiresAt,
        createdAt: new Date().toISOString(),
      };
      setInvites((prev) => [optimistic, ...prev]);
      setEmail("");
      addToast({
        title: "Invite created",
        description: `Invite link ready for ${trimmedEmail}.`,
        color: "success",
      });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create invite.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Member row actions ───────────────────────────────────────────

  /**
   * Change a member's role across every workspace where the operator
   * can manage them. We don't expose a per-workspace role editor in
   * this surface — pod-wide role parity is the right default for a
   * small ops dashboard. Operators who need per-workspace fidelity
   * can drop into Browser settings.
   */
  async function handleChangeRole(target: WirePodMember, next: EditableRole) {
    if (target.id === me?.id) {
      addToast({
        title: "Can't change your own role",
        color: "warning",
      });
      return;
    }
    setPendingUserId(target.id);
    try {
      // Apply to every workspace where the target is currently a
      // member AND the operator can act. The backend's
      // updateMemberRole is per-workspace, so we iterate.
      const ops = target.workspaces.map((w) =>
        podMutate("workspaces.updateMemberRole", {
          workspaceId: w.id,
          userId: target.id,
          role: next,
        }).catch((err) => ({ workspaceId: w.id, error: String(err) })),
      );
      await Promise.all(ops);
      addToast({
        title: `Role updated to ${next}`,
        color: "success",
      });
      await load();
    } catch (err) {
      addToast({
        title: "Couldn't update role",
        description: err instanceof Error ? err.message : undefined,
        color: "danger",
      });
    } finally {
      setPendingUserId(null);
    }
  }

  async function confirmRemoveFromPod() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await podMutate<{ removedFromWorkspaces: number; totalWorkspaces: number }>(
        "workspaces.removeFromPod",
        { userId: removeTarget.id },
      );
      addToast({
        title: "Member removed",
        description: `${removeTarget.email} has been removed from every workspace you manage.`,
        color: "success",
      });
      setRemoveTarget(null);
      await load();
    } catch (err) {
      addToast({
        title: "Couldn't remove member",
        description: err instanceof Error ? err.message : undefined,
        color: "danger",
      });
    } finally {
      setRemoving(false);
    }
  }

  // ─── Invite row actions ───────────────────────────────────────────

  async function handleCopyInvite(invite: WireInvite) {
    try {
      const url = `${window.location.origin}/invite/${invite.token}`;
      await navigator.clipboard.writeText(url);
      setCopiedInviteId(invite.id);
      addToast({ title: "Link copied", color: "success" });
      window.setTimeout(() => setCopiedInviteId(null), 1600);
    } catch {
      addToast({ title: "Couldn't copy", color: "danger" });
    }
  }

  async function handleCancelInvite(invite: WireInvite) {
    setPendingInviteId(invite.id);
    try {
      await podMutate("workspaces.revokeInvite", { id: invite.id });
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      addToast({ title: "Invite cancelled", color: "success" });
    } catch (err) {
      addToast({
        title: "Couldn't cancel invite",
        description: err instanceof Error ? err.message : undefined,
        color: "danger",
      });
    } finally {
      setPendingInviteId(null);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────

  // Last-owner detection for the Remove modal copy. We compute it on
  // open: if the target is the only owner of any workspace, the
  // backend will refuse — surface that ahead of time so the operator
  // doesn't click into a 400.
  const removeTargetBlocked = useMemo(() => {
    if (!removeTarget) return null;
    // Check if target is sole owner of any workspace they're in.
    const blockedWs = removeTarget.workspaces.filter(
      (w) => w.role === "owner",
    );
    if (blockedWs.length === 0) return null;
    // We don't know the owner counts of OTHER workspaces from this
    // view, so we surface a warning rather than a hard block.
    // Backend enforces the actual rule.
    return blockedWs;
  }, [removeTarget]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <p className="text-sm font-medium text-foreground/55">Pod members</p>
        <h1 className="mt-1 font-heading text-3xl font-medium tracking-tight text-foreground">
          Members
        </h1>
        <p className="mt-1 max-w-2xl text-foreground/65">
          People who have access to this pod across every workspace you can see.
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
            <p className="text-[13px] font-medium text-foreground">Members</p>
          </div>
          {!isLoading && !loadError && (
            <Chip size="sm" variant="flat" radius="sm">
              {members.length}
            </Chip>
          )}
        </div>
        <div className="border-t border-foreground/[0.06]" />
        <div className="px-5 py-4">
          {isLoading && (
            <div className="flex items-center gap-3 text-[13px] text-foreground/55">
              <Spinner size="sm" color="primary" />
              <span>Loading members…</span>
            </div>
          )}
          {!isLoading && loadError && (
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                strokeWidth={2.2}
              />
              <p className="text-[12.5px] leading-snug text-foreground/65">
                {loadError}
              </p>
            </div>
          )}
          {!isLoading && !loadError && members.length === 0 && (
            <p className="text-[13px] text-foreground/55">
              No members yet. Invite a teammate below to get started.
            </p>
          )}
          {!isLoading && !loadError && members.length > 0 && (
            <ul className="flex flex-col gap-1">
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isSelf={m.id === me?.id}
                  isPending={pendingUserId === m.id}
                  onChangeRole={(role) => void handleChangeRole(m, role)}
                  onRemove={() => setRemoveTarget(m)}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Pending invites */}
      <Card
        isBlurred
        shadow="none"
        radius="md"
        className="bg-foreground/[0.04] ring-1 ring-inset ring-foreground/10"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-foreground/55" strokeWidth={2} />
            <p className="text-[13px] font-medium text-foreground">
              Pending invites
            </p>
          </div>
          {!isLoading && !loadError && invites.length > 0 && (
            <Chip size="sm" variant="flat" radius="sm">
              {invites.length}
            </Chip>
          )}
        </div>
        <div className="border-t border-foreground/[0.06]" />
        <div className="px-5 py-4">
          {isLoading && (
            <div className="flex items-center gap-3 text-[13px] text-foreground/55">
              <Spinner size="sm" color="primary" />
              <span>Loading invites…</span>
            </div>
          )}
          {!isLoading && invites.length === 0 && (
            <p className="text-[13px] text-foreground/55">
              No pending invites. Use the form below to invite someone.
            </p>
          )}
          {!isLoading && invites.length > 0 && (
            <ul className="flex flex-col gap-1">
              {invites.map((inv) => (
                <InviteRow
                  key={inv.id}
                  invite={inv}
                  isCopied={copiedInviteId === inv.id}
                  isPending={pendingInviteId === inv.id}
                  onCopy={() => void handleCopyInvite(inv)}
                  onCancel={() => void handleCancelInvite(inv)}
                />
              ))}
            </ul>
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
          <Send className="h-4 w-4 text-foreground/55" strokeWidth={2} />
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
                  : "Scoped to one workspace."
              }
            >
              <SelectItem key="pod">Pod (all workspaces)</SelectItem>
              <SelectItem key="workspace">Single workspace</SelectItem>
            </Select>
          </div>

          {inviteType === "workspace" && (
            <Select
              size="md"
              radius="md"
              variant="flat"
              label="Workspace"
              labelPlacement="outside"
              selectedKeys={inviteWorkspaceId ? [inviteWorkspaceId] : []}
              onSelectionChange={(keys) => {
                const next = String(Array.from(keys)[0] ?? "");
                if (next) setInviteWorkspaceId(next);
              }}
              isDisabled={submitting || workspaces.length === 0}
              placeholder={
                workspaces.length === 0
                  ? "No workspaces available"
                  : "Pick a workspace"
              }
            >
              {workspaces.map((w) => (
                <SelectItem key={w.id}>{w.name}</SelectItem>
              ))}
            </Select>
          )}

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
                !emailLooksValid ||
                (inviteType === "workspace" && !inviteWorkspaceId)
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

      {/* Remove from pod confirmation modal */}
      <Modal
        isOpen={removeTarget !== null}
        onClose={() => {
          if (!removing) setRemoveTarget(null);
        }}
        size="md"
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <span>Remove from pod?</span>
                <span className="text-[12px] font-normal text-foreground/55">
                  {removeTarget?.email}
                </span>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-foreground/75">
                  This removes{" "}
                  <span className="font-medium text-foreground">
                    {removeTarget?.name ?? removeTarget?.email}
                  </span>{" "}
                  from every workspace on this pod that you can manage.
                  They&apos;ll lose access immediately. The user account
                  itself is kept so audit history stays intact.
                </p>
                {removeTargetBlocked && removeTargetBlocked.length > 0 && (
                  <div
                    role="alert"
                    className="
                      mt-3 flex items-start gap-2
                      rounded-lg
                      bg-warning/10 ring-1 ring-inset ring-warning/30
                      px-3 py-2
                    "
                  >
                    <ShieldAlert
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                      strokeWidth={2.2}
                      aria-hidden
                    />
                    <p className="text-[12.5px] leading-snug text-foreground">
                      They&apos;re an owner of{" "}
                      {removeTargetBlocked
                        .map((w) => w.name)
                        .filter(Boolean)
                        .join(", ")}
                      . If they&apos;re the only owner, removal will be
                      blocked — promote another member first.
                    </p>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button
                  size="sm"
                  variant="light"
                  onPress={() => setRemoveTarget(null)}
                  isDisabled={removing}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  color="danger"
                  isLoading={removing}
                  onPress={() => void confirmRemoveFromPod()}
                  startContent={
                    removing ? undefined : <Trash2 className="h-3.5 w-3.5" />
                  }
                >
                  Remove from pod
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

// ─── Member row ──────────────────────────────────────────────────────

function MemberRow({
  member,
  isSelf,
  isPending,
  onChangeRole,
  onRemove,
}: {
  member: WirePodMember;
  isSelf: boolean;
  isPending: boolean;
  onChangeRole: (role: EditableRole) => void;
  onRemove: () => void;
}) {
  const name =
    member.name?.trim() || member.email.split("@")[0] || "Member";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "?";
  const additional = Math.max(0, member.workspaceCount - 1);
  // Owners can't be re-roled to admin/editor/viewer through this UI —
  // changing ownership is a workspace-transfer flow, not a role bump.
  const canEditRole = !isSelf && member.primaryRole !== "owner";
  // Self can't be removed from this surface.
  const canRemove = !isSelf;
  // If the user has no actions available, hide the dropdown entirely
  // rather than render an empty trigger.
  const showActions = canEditRole || canRemove;

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
          {isSelf && (
            <span className="ml-2 text-[11px] font-normal text-foreground/55">
              you
            </span>
          )}
        </p>
        <p className="truncate text-[12px] text-foreground/55">
          {member.email}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Chip
          size="sm"
          variant="flat"
          radius="sm"
          className="shrink-0 capitalize"
          color={
            member.primaryRole === "owner"
              ? "primary"
              : member.primaryRole === "admin"
                ? "secondary"
                : "default"
          }
        >
          {member.primaryRole}
        </Chip>
        {additional > 0 && (
          <Chip size="sm" variant="flat" radius="sm" className="shrink-0">
            +{additional} more {additional === 1 ? "workspace" : "workspaces"}
          </Chip>
        )}
        {isPending && <Spinner size="sm" color="primary" />}
        {showActions && !isPending && (
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <button
                type="button"
                className="
                  inline-flex h-8 w-8 items-center justify-center
                  rounded-lg
                  text-foreground/55 hover:text-foreground hover:bg-foreground/[0.06]
                  transition-colors
                "
                aria-label={`Actions for ${member.email}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label={`Actions for ${member.email}`}
              disabledKeys={[
                ...(canEditRole ? [] : ["role-admin", "role-editor", "role-viewer"]),
                ...(canRemove ? [] : ["remove"]),
                // Don't offer the role they already have.
                `role-${member.primaryRole}`,
              ]}
            >
              <DropdownItem
                key="role-admin"
                startContent={<UserCog className="h-3.5 w-3.5" />}
                onPress={() => onChangeRole("admin")}
              >
                Make admin
              </DropdownItem>
              <DropdownItem
                key="role-editor"
                startContent={<UserCog className="h-3.5 w-3.5" />}
                onPress={() => onChangeRole("editor")}
              >
                Make editor
              </DropdownItem>
              <DropdownItem
                key="role-viewer"
                startContent={<UserCog className="h-3.5 w-3.5" />}
                onPress={() => onChangeRole("viewer")}
              >
                Make viewer
              </DropdownItem>
              <DropdownItem
                key="remove"
                color="danger"
                className="text-danger"
                startContent={<UserMinus className="h-3.5 w-3.5" />}
                onPress={onRemove}
              >
                Remove from pod
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        )}
      </div>
    </li>
  );
}

// ─── Invite row ──────────────────────────────────────────────────────

function InviteRow({
  invite,
  isCopied,
  isPending,
  onCopy,
  onCancel,
}: {
  invite: WireInvite;
  isCopied: boolean;
  isPending: boolean;
  onCopy: () => void;
  onCancel: () => void;
}) {
  const expiresAt = new Date(invite.expiresAt);
  const expiresIn = formatRelativeFuture(expiresAt);
  const expired = expiresAt.getTime() <= Date.now();

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
          bg-foreground/[0.06]
          ring-1 ring-inset ring-foreground/10
        "
      >
        <Mail className="h-3.5 w-3.5 text-foreground/55" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">
          {invite.email}
        </p>
        <p className="truncate text-[12px] text-foreground/55">
          {invite.type === "pod"
            ? "Pod invite (all workspaces)"
            : `Workspace · ${invite.workspaceName ?? "—"}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Chip
          size="sm"
          variant="flat"
          radius="sm"
          className="shrink-0 capitalize"
        >
          {invite.role}
        </Chip>
        <span
          className={`
            hidden shrink-0 text-[11.5px] sm:inline-block
            ${expired ? "text-warning" : "text-foreground/40"}
          `}
        >
          {expired ? "expired" : `expires ${expiresIn}`}
        </span>
        {isPending && <Spinner size="sm" color="primary" />}
        {!isPending && (
          <>
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              radius="md"
              aria-label="Copy invite link"
              onPress={onCopy}
              className="shrink-0"
            >
              {isCopied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              radius="md"
              aria-label="Cancel invite"
              onPress={onCancel}
              className="shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5 text-foreground/55" />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

// ─── Date helpers ────────────────────────────────────────────────────

function formatRelativeFuture(date: Date): string {
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `in ${days}d`;
  const weeks = Math.round(days / 7);
  return `in ${weeks}w`;
}
