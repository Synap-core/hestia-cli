"use client";

/**
 * Eve OS — Inbox (`/inbox`).
 *
 * Daily-driver governance surface. Three lazy-loaded tabs:
 *
 *   • Proposals     — pending AI/connector mutations awaiting review.
 *                     Each row has Approve / Reject buttons; optimistic
 *                     remove on success, refetch on failure.
 *   • Notifications — unified alert stream from the pod (proposals,
 *                     proactive nudges, system, data). Click → opens
 *                     `actionUrl` in a new tab.
 *   • Activity      — recent event log entries grouped by day.
 *
 * Every tab calls a same-origin proxy under `/api/hub/*` which forwards
 * to the paired pod with the operator's API key. When the pod isn't
 * paired (no `~/.eve/secrets.json` synap entry), the proxies return
 * 503 — the page swaps to a "Sign-in required" empty state with a
 * deep-link to `/settings`.
 *
 * Design notes:
 *   • HeroUI primitives only (Card, Button, Tabs, Tab, Chip, Spinner,
 *     addToast). No raw `<div className="bg-…">` for theming surfaces.
 *   • Concentric radii: pane 32 → body 20 → card 12 (`radius="md"`).
 *   • visionOS material: `bg-foreground/[0.04] ring-1 ring-inset
 *     ring-foreground/10` — no drop shadows.
 *   • Text uses `text-foreground` + opacity tiers, never `text-default-X`.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner, Tab, Tabs } from "@heroui/react";
import { PaneHeader } from "../components/pane-header";
import { ProposalsPanel } from "./components/proposals-panel";
import { NotificationsPanel } from "./components/notifications-panel";
import { ActivityPanel } from "./components/activity-panel";
import { PodNotPairedCard } from "./components/pod-not-paired-card";

type TabKey = "proposals" | "notifications" | "activity";

export default function InboxPage() {
  return (
    <Suspense fallback={<InboxFallback />}>
      <InboxInner />
    </Suspense>
  );
}

function InboxFallback() {
  return (
    <>
      <PaneHeader title="Inbox" />
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    </>
  );
}

function InboxInner() {
  const router = useRouter();
  const [active, setActive] = useState<TabKey>("proposals");
  // A 503 from any proxy means the pod isn't paired. We surface a
  // single shared state across tabs — paired? we render the panels.
  // unpaired? we render the unpaired Card and don't bother loading.
  const [pairing, setPairing] = useState<"unknown" | "paired" | "unpaired">(
    "unknown",
  );

  // Probe pairing once on mount via the user-channel `/api/pod/*` proxy.
  // Two failure modes count as "unpaired":
  //   - 503 no-pod-url        — the pod URL hasn't been configured yet.
  //   - 401 no-pod-session    — no `pod.userToken` cached AND no email
  //                             remembered, so the proxy can't auto-mint.
  // Any other status (including upstream 401 after a successful mint
  // path) means we're paired and the per-tab loader can take over.
  const checkPairing = useCallback(async () => {
    try {
      const input = encodeURIComponent(
        JSON.stringify({ json: { status: "pending" } }),
      );
      const r = await fetch(`/api/pod/trpc/proposals.list?input=${input}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (r.status === 503) setPairing("unpaired");
      else if (r.status === 401) {
        const body = (await r.json().catch(() => null)) as
          | { error?: string }
          | null;
        setPairing(body?.error === "no-pod-session" ? "unpaired" : "paired");
      } else setPairing("paired");
    } catch {
      setPairing("paired"); // network blip — let the per-tab loader retry
    }
  }, []);

  useEffect(() => {
    void checkPairing();
  }, [checkPairing]);

  return (
    <>
      <PaneHeader title="Inbox" back={() => router.push("/")} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-4 sm:px-6 sm:pt-5">
        {pairing === "unknown" ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner size="md" />
          </div>
        ) : pairing === "unpaired" ? (
          <PodNotPairedCard onOpenSettings={() => router.push("/settings")} />
        ) : (
          <PairedInboxBody active={active} onChange={setActive} />
        )}
      </div>
    </>
  );
}

function PairedInboxBody({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (k: TabKey) => void;
}) {
  // Each panel maintains its own data but we don't lazily mount them —
  // mounting then hiding lets the previous tab's data stay warm without
  // a remount/refetch cycle on tab-toggle. Memo the tab handlers so
  // HeroUI's controlled Tabs don't re-render the content tree.
  const handleSelection = useMemo(
    () => (k: React.Key) => {
      onChange(String(k) as TabKey);
    },
    [onChange],
  );

  return (
    <>
      <header className="mb-4">
        <h1 className="text-[22px] font-medium tracking-tight text-foreground">
          Inbox
        </h1>
        <p className="text-[13px] text-foreground/55">
          Approve proposals, read alerts, watch the activity stream.
        </p>
      </header>

      <Tabs
        aria-label="Inbox sections"
        variant="underlined"
        size="sm"
        selectedKey={active}
        onSelectionChange={handleSelection}
        className="-mb-px"
      >
        <Tab key="proposals" title="Proposals" />
        <Tab key="notifications" title="Notifications" />
        <Tab key="activity" title="Activity" />
      </Tabs>

      <div className="mt-5 flex flex-1 flex-col gap-4">
        {active === "proposals" && <ProposalsPanel />}
        {active === "notifications" && <NotificationsPanel />}
        {active === "activity" && <ActivityPanel />}
      </div>
    </>
  );
}

