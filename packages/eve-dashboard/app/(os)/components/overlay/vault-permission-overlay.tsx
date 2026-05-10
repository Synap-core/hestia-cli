"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Chip } from "@heroui/react";
import {
  Lock, Shield, ShieldCheck, ShieldX, X, Maximize2,
  Minimize2,
} from "lucide-react";
import { VaultApp } from "../../settings/vault/vault-components";
import { useOverlayStore, type OverlayEntry } from "../../stores/overlay-store";
import { PodConnectGate } from "../auth/PodConnectGate";

// ─── Capability rows ──────────────────────────────────────────────────────────

const CAPABILITY_LABELS: Record<string, string> = {
  "read:entities":  "Read your entities and data",
  "write:entities": "Create and update entities",
  "read:vault":     "Access vault references",
  "write:channel":  "Post to channels",
  "read:channels":  "Read channel history",
  "execute:agent":  "Run agent actions",
};

function CapabilityRow({ cap }: { cap: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-divider bg-content2/30 px-3 py-2.5">
      <Shield className="h-3.5 w-3.5 shrink-0 text-foreground/40" strokeWidth={1.5} />
      <p className="text-[12.5px] text-foreground/75">
        {CAPABILITY_LABELS[cap] ?? cap.replace(/:/g, " · ")}
      </p>
    </div>
  );
}

// ─── Permission request panel ─────────────────────────────────────────────────

function PermissionPanel({ entry, onClose }: { entry: OverlayEntry; onClose: () => void }) {
  const { resolvePending } = useOverlayStore();
  const requestId = entry.payload?.requestId as string | undefined;
  const appId = (entry.payload?.requestingAppId as string | undefined) ?? "Unknown app";
  const capabilities = (entry.payload?.capabilities as string[] | undefined) ?? [];
  const reason = entry.payload?.reason as string | undefined;
  const [resolving, setResolving] = useState<"approving" | "denying" | null>(null);

  const resolve = (result: "approved" | "denied") => {
    setResolving(result === "approved" ? "approving" : "denying");
    if (requestId) resolvePending(requestId, result);
    onClose();
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.07] text-[16px] font-bold text-foreground/60">
          {appId[0]?.toUpperCase() ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground/90">{appId}</p>
          <p className="text-[11.5px] text-foreground/45">Requesting access</p>
        </div>
        <Chip size="sm" variant="flat" color="warning" className="shrink-0 text-[11px]">Pending</Chip>
      </div>

      {reason && (
        <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-foreground/60">&ldquo;{reason}&rdquo;</p>
        </div>
      )}

      {capabilities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-foreground/30">
            Wants permission to
          </p>
          {capabilities.map((cap) => <CapabilityRow key={cap} cap={cap} />)}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button fullWidth variant="flat" color="danger" size="sm"
          isLoading={resolving === "denying"}
          startContent={!resolving ? <ShieldX className="h-3.5 w-3.5" /> : undefined}
          onPress={() => resolve("denied")}>
          Deny
        </Button>
        <Button fullWidth color="primary" size="sm"
          isLoading={resolving === "approving"}
          startContent={!resolving ? <ShieldCheck className="h-3.5 w-3.5" /> : undefined}
          onPress={() => resolve("approved")}>
          Approve
        </Button>
      </div>
      <p className="text-center text-[10px] text-foreground/20">
        Access ends when the app session closes.
      </p>
    </div>
  );
}

// ─── Picker banner (shown when an app requested a vault ref) ──────────────────

function PickerBanner({ appId, onCancel }: { appId: string; onCancel: () => void }) {
  return (
    <div className="mx-4 mb-3 flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2">
      <Lock className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={1.5} />
      <p className="flex-1 text-[11.5px] text-foreground/65">
        <span className="font-medium text-foreground/85">{appId}</span>
        {" "}wants a vault reference. Use{" "}
        <span className="font-medium">Share ref</span> on a secret.
      </p>
      <button onClick={onCancel} className="shrink-0 text-foreground/30 hover:text-foreground/60 transition-colors">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Shared header ────────────────────────────────────────────────────────────

function Header({
  tab, setTab, hasPermission, expanded, onToggleExpand, onClose,
}: {
  tab: "vault" | "permission";
  setTab: (t: "vault" | "permission") => void;
  hasPermission: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.07] px-3 py-2.5">
      <button onClick={() => setTab("vault")}
        className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
          tab === "vault" ? "bg-white/[0.08] text-foreground" : "text-foreground/40 hover:text-foreground/65"
        }`}>
        Vault
      </button>
      {hasPermission && (
        <button onClick={() => setTab("permission")}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
            tab === "permission" ? "bg-white/[0.08] text-foreground" : "text-foreground/40 hover:text-foreground/65"
          }`}>
          Permissions
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[9px] font-bold text-black">1</span>
        </button>
      )}
      <div className="flex-1" />
      <button onClick={onToggleExpand} aria-label={expanded ? "Collapse" : "Expand"}
        className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-white/[0.07] hover:text-foreground/60">
        {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
      <button onClick={onClose} aria-label="Close"
        className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-white/[0.07] hover:text-foreground/60">
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

// ─── Main overlay ─────────────────────────────────────────────────────────────

export interface VaultPermissionOverlayProps {
  entry: OverlayEntry;
  onClose: () => void;
}

export function VaultPermissionOverlay({ entry, onClose }: VaultPermissionOverlayProps) {
  const { resolvePending } = useOverlayStore();
  const [tab, setTab] = useState<"vault" | "permission">(
    entry.kind === "permission" ? "permission" : "vault",
  );
  const [expanded, setExpanded] = useState(false);

  const requestId = entry.payload?.requestId as string | undefined;
  const appId = entry.payload?.requestingAppId as string | undefined;
  const isPickerMode = entry.kind === "vault" && !!requestId;
  const hasPermission = entry.kind === "permission";

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (requestId) resolvePending(requestId, "cancelled");
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestId, onClose, resolvePending]);

  const handleSelectRef = (vaultRef: string) => {
    if (requestId) resolvePending(requestId, "approved", { secretRef: vaultRef });
    onClose();
  };

  const handleClose = () => {
    if (requestId) resolvePending(requestId, "cancelled");
    onClose();
  };

  // ── Expanded: full right sheet (same pattern as agent overlay) ──────────────
  if (expanded) {
    return (
      <>
        <motion.div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }} onClick={handleClose} aria-hidden />

        <motion.aside
          className="fixed right-0 top-0 z-30 flex h-full w-[380px] flex-col border-l border-white/[0.08] bg-background shadow-2xl backdrop-blur-2xl"
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          role="dialog" aria-modal aria-label="Vault"
          onClick={(e) => e.stopPropagation()}>
          <Header tab={tab} setTab={setTab} hasPermission={hasPermission}
            expanded={expanded} onToggleExpand={() => setExpanded(false)} onClose={handleClose} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "vault" && (
              <>
                {isPickerMode && appId && (
                  <PickerBanner appId={appId} onCancel={handleClose} />
                )}
                <div className="px-4 pb-6 pt-3">
                  <PodConnectGate>
                    <VaultApp onSelectRef={isPickerMode ? handleSelectRef : undefined} />
                  </PodConnectGate>
                </div>
              </>
            )}
            {tab === "permission" && (
              <PermissionPanel entry={entry} onClose={onClose} />
            )}
          </div>
        </motion.aside>
      </>
    );
  }

  // ── Compact: top-right popover ──────────────────────────────────────────────
  return (
    <>
      {/* Backdrop — subtle, doesn't compete with content */}
      <motion.div className="fixed inset-0 z-30"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.1 }} onClick={handleClose} aria-hidden />

      <motion.div
        className="fixed right-4 top-4 z-30 flex w-[340px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-background/90 shadow-2xl backdrop-blur-2xl"
        style={{ maxHeight: "min(520px, calc(100vh - 100px))" }}
        initial={{ opacity: 0, scale: 0.95, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -8 }}
        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1], transformOrigin: "top right" }}
        role="dialog" aria-modal aria-label="Vault"
        onClick={(e) => e.stopPropagation()}>

        <Header tab={tab} setTab={setTab} hasPermission={hasPermission}
          expanded={expanded} onToggleExpand={() => setExpanded(true)} onClose={handleClose} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "vault" && (
            <>
              {isPickerMode && appId && (
                <PickerBanner appId={appId} onCancel={handleClose} />
              )}
              <div className="px-4 pb-4 pt-3">
                <PodConnectGate>
                  <VaultApp onSelectRef={isPickerMode ? handleSelectRef : undefined} />
                </PodConnectGate>
              </div>
            </>
          )}
          {tab === "permission" && (
            <PermissionPanel entry={entry} onClose={onClose} />
          )}
        </div>
      </motion.div>
    </>
  );
}
