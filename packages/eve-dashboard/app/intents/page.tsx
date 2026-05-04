"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Spinner,
  Chip,
  Button,
  addToast,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  useDisclosure,
} from "@heroui/react";
import {
  RefreshCw,
  CalendarClock,
  Plus,
  MoreVertical,
  Play,
  Pause,
  Pencil,
  Trash2,
  AlertCircle,
} from "lucide-react";
import type { BackgroundTask, BackgroundTaskStatus } from "@eve/dna";
import { IntentFormModal } from "./intent-form-modal";

// ---------------------------------------------------------------------------
// Relative time helper — keeps display fluid w/o a date library.
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMs = t - Date.now();
  const abs = Math.abs(diffMs);
  const sec = Math.round(abs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);

  let label: string;
  if (sec < 45) label = `${sec}s`;
  else if (min < 45) label = `${min}m`;
  else if (hr < 22) label = `${hr}h`;
  else label = `${day}d`;

  return diffMs >= 0 ? `in ${label}` : `${label} ago`;
}

function formatSchedule(t: BackgroundTask): string {
  if (!t.schedule) {
    return t.type === "event" ? "event-triggered" : t.type;
  }
  return `${t.type} • ${t.schedule}`;
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: BackgroundTaskStatus }) {
  if (status === "active") {
    return (
      <Chip size="sm" color="success" variant="flat">
        active
      </Chip>
    );
  }
  if (status === "paused") {
    return (
      <Chip size="sm" color="default" variant="flat">
        paused
      </Chip>
    );
  }
  return (
    <Chip
      size="sm"
      color="danger"
      variant="flat"
      startContent={<AlertCircle className="h-3 w-3" />}
    >
      error
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntentsPage() {
  const router = useRouter();
  const [intents, setIntents] = useState<BackgroundTask[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BackgroundTask | null>(null);
  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();

  const fetchIntents = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        const res = await fetch("/api/intents", { credentials: "include" });
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setLoadError(body.error ?? `API responded with ${res.status}`);
          return;
        }
        const data = (await res.json()) as { tasks?: BackgroundTask[] };
        setLoadError(null);
        setIntents(Array.isArray(data.tasks) ? data.tasks : []);
      } catch (err) {
        setLoadError(
          `Could not reach API — ${
            err instanceof Error ? err.message : "Network error"
          }`,
        );
        if (!silent) addToast({ title: "Failed to load intents", color: "danger" });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void fetchIntents();
    const interval = setInterval(() => void fetchIntents(true), 30_000);
    return () => clearInterval(interval);
  }, [fetchIntents]);

  // -------------------------------------------------------------------------
  // Row actions
  // -------------------------------------------------------------------------

  async function patchIntent(
    id: string,
    patch: Record<string, unknown>,
    successMsg: string,
  ) {
    try {
      const res = await fetch(`/api/intents/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        addToast({
          title: body.error ?? `Update failed (${res.status})`,
          color: "danger",
        });
        return;
      }
      addToast({ title: successMsg, color: "success" });
      void fetchIntents(true);
    } catch (err) {
      addToast({
        title: err instanceof Error ? err.message : "Network error",
        color: "danger",
      });
    }
  }

  async function deleteIntent(id: string) {
    if (!confirm("Delete this intent? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/intents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        addToast({
          title: body.error ?? `Delete failed (${res.status})`,
          color: "danger",
        });
        return;
      }
      addToast({ title: "Intent deleted", color: "success" });
      void fetchIntents(true);
    } catch (err) {
      addToast({
        title: err instanceof Error ? err.message : "Network error",
        color: "danger",
      });
    }
  }

  function runNow(t: BackgroundTask) {
    void patchIntent(
      t.id,
      { nextRunAt: new Date().toISOString() },
      "Scheduled to run on next poll",
    );
  }

  function togglePause(t: BackgroundTask) {
    const next: BackgroundTaskStatus = t.status === "paused" ? "active" : "paused";
    void patchIntent(
      t.id,
      { status: next },
      next === "paused" ? "Intent paused" : "Intent resumed",
    );
  }

  function openCreate() {
    setEditing(null);
    onOpen();
  }

  function openEdit(t: BackgroundTask) {
    setEditing(t);
    onOpen();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh] text-default-500">
        <Spinner size="lg" color="primary" />
        <p className="text-sm">Loading intents…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-default-500">Intents</p>
          <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
            Background tasks
          </h1>
          <p className="mt-1 text-default-500">
            Background tasks Hermes runs on a schedule.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="bordered"
            size="sm"
            radius="md"
            isLoading={refreshing}
            startContent={!refreshing ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
            onPress={() => void fetchIntents()}
          >
            Refresh
          </Button>
          <Button
            color="primary"
            size="sm"
            radius="md"
            startContent={<Plus className="h-3.5 w-3.5" />}
            onPress={openCreate}
          >
            Add intent
          </Button>
        </div>
      </header>

      {loadError && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Couldn&apos;t load intents</p>
          <p className="mt-0.5 text-default-500">{loadError}</p>
        </div>
      )}

      <section className="rounded-xl border border-divider bg-content1 overflow-hidden">
        {intents && intents.length === 0 ? (
          <div className="p-8 text-center">
            <CalendarClock className="mx-auto h-8 w-8 text-default-300" />
            <p className="mt-3 text-sm font-medium text-foreground">No intents yet</p>
            <p className="mt-1 text-sm text-default-500">
              Click &quot;Add intent&quot; to schedule background work.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-content2/40 text-left text-[11px] uppercase tracking-wider text-default-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Schedule</th>
                  <th className="px-4 py-2.5 font-medium">Next run</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Runs</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(intents ?? []).map((t, i) => (
                  <tr
                    key={t.id}
                    className={
                      "align-top " + (i > 0 ? "border-t border-divider" : "")
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{t.name}</div>
                      {t.description && (
                        <div className="mt-0.5 text-xs text-default-500 line-clamp-2">
                          {t.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Chip size="sm" variant="flat" className="font-mono text-[11px]">
                        {t.action}
                      </Chip>
                    </td>
                    <td className="px-4 py-3 text-default-600">
                      {formatSchedule(t)}
                    </td>
                    <td className="px-4 py-3 text-default-600" title={t.nextRunAt ?? ""}>
                      {formatRelative(t.nextRunAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusChip status={t.status} />
                        {t.errorMessage && (
                          <span
                            className="text-[11px] text-danger line-clamp-1"
                            title={t.errorMessage}
                          >
                            {t.errorMessage}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-default-600">
                      <span className="font-mono text-[11px]">
                        {t.successCount}/{t.executionCount}
                      </span>
                      {t.failureCount > 0 && (
                        <span
                          className="ml-1 font-mono text-[11px] text-danger"
                          title={`${t.failureCount} failures`}
                        >
                          ({t.failureCount}!)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Dropdown placement="bottom-end">
                        <DropdownTrigger>
                          <Button
                            isIconOnly
                            variant="light"
                            size="sm"
                            aria-label="Intent actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                          aria-label="Intent actions"
                          onAction={(key) => {
                            if (key === "run") runNow(t);
                            else if (key === "toggle") togglePause(t);
                            else if (key === "edit") openEdit(t);
                            else if (key === "delete") void deleteIntent(t.id);
                          }}
                        >
                          <DropdownItem
                            key="run"
                            startContent={<Play className="h-4 w-4" />}
                          >
                            Run now
                          </DropdownItem>
                          <DropdownItem
                            key="toggle"
                            startContent={
                              t.status === "paused" ? (
                                <Play className="h-4 w-4" />
                              ) : (
                                <Pause className="h-4 w-4" />
                              )
                            }
                          >
                            {t.status === "paused" ? "Resume" : "Pause"}
                          </DropdownItem>
                          <DropdownItem
                            key="edit"
                            startContent={<Pencil className="h-4 w-4" />}
                          >
                            Edit
                          </DropdownItem>
                          <DropdownItem
                            key="delete"
                            className="text-danger"
                            color="danger"
                            startContent={<Trash2 className="h-4 w-4" />}
                          >
                            Delete
                          </DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <IntentFormModal
        isOpen={isOpen}
        onOpenChange={(open) => {
          onOpenChange();
          if (!open) setEditing(null);
        }}
        intent={editing}
        onSaved={() => {
          onClose();
          setEditing(null);
          void fetchIntents(true);
        }}
      />
    </div>
  );
}
