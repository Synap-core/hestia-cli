"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Button, Chip } from "@heroui/react";
import { Lock, Shield, ShieldCheck, ShieldX, X } from "lucide-react";
import { VaultApp } from "../../settings/vault/vault-components";
import { useOverlayStore, type OverlayEntry } from "../../stores/overlay-store";
import { PodConnectGate } from "../auth/PodConnectGate";

// ─── Capability display ───────────────────────────────────────────────────────

const CAPABILITY_LABELS: Record<string, string> = {
  "read:entities":   "Read your entities and data",
  "write:entities":  "Create and update entities",
  "read:vault":      "Access vault references",
  "write:channel":   "Post to channels",
  "read:channels":   "Read channel history",
  "execute:agent":   "Run agent actions",
};

function CapabilityRow({ cap }: { cap: string }) {
  const label = CAPABILITY_LABELS[cap] ?? cap.replace(/:/g, " · ");
  return (
    <div className="flex items-center gap-3 rounded-xl border border-divider bg-content2/30 px-3 py-2.5">
      <Shield className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={1.5} />
      <p className="text-[13px] text-foreground/80">{label}</p>
    </div>
  );
}

// ─── Permission request view ──────────────────────────────────────────────────

function PermissionRequest({ entry, onClose }: { entry: OverlayEntry; onClose: () => void }) {
  const { resolvePending } = useOverlayStore();
  const requestId = entry.payload?.requestId as string | undefined;
  const appId = entry.payload?.requestingAppId as string ?? "Unknown app";
  const capabilities = (entry.payload?.capabilities as string[] | undefined) ?? [];
  const reason = entry.payload?.reason as string | undefined;

  const [resolving, setResolving] = useState<"approving" | "denying" | null>(null);

  const resolve = (result: "approved" | "denied") => {
    setResolving(result === "approved" ? "approving" : "denying");
    if (requestId) resolvePending(requestId, result);
    onClose();
  };

  return (
    <div className="flex flex-col gap-5 px-5 py-4">
      {/* App identity */}
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-foreground/[0.06] text-[18px] font-bold text-foreground/60">
          {appId[0]?.toUpperCase() ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-foreground/90">{appId}</p>
          <p className="text-[12px] text-foreground/45">Requesting access</p>
        </div>
        <Chip size="sm" variant="flat" color="warning" className="shrink-0 text-[11px]">
          Pending
        </Chip>
      </div>

      {/* Reason */}
      {reason && (
        <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-foreground/60">&ldquo;{reason}&rdquo;</p>
        </div>
      )}

      {/* Capabilities */}
      {capabilities.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground/35">
            Wants permission to
          </p>
          <div className="space-y-1.5">
            {capabilities.map((cap) => (
              <CapabilityRow key={cap} cap={cap} />
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2.5 pt-1">
        <Button
          fullWidth
          variant="flat"
          color="danger"
          size="sm"
          isLoading={resolving === "denying"}
          startContent={!resolving ? <ShieldX className="h-3.5 w-3.5" /> : undefined}
          onPress={() => resolve("denied")}
        >
          Deny
        </Button>
        <Button
          fullWidth
          color="primary"
          size="sm"
          isLoading={resolving === "approving"}
          startContent={!resolving ? <ShieldCheck className="h-3.5 w-3.5" /> : undefined}
          onPress={() => resolve("approved")}
        >
          Approve
        </Button>
      </div>

      <p className="text-center text-[10.5px] text-foreground/25">
        Approving grants access until the app session ends.
      </p>
    </div>
  );
}

// ─── Vault picker banner ──────────────────────────────────────────────────────

function VaultPickerBanner({ appId, onCancel }: { appId: string; onCancel: () => void }) {
  return (
    <div className="mx-5 mb-3 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2.5">
      <Lock className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.5} />
      <p className="flex-1 text-[12px] text-foreground/70">
        <span className="font-medium text-foreground/90">{appId}</span>
        {" "}is requesting a vault reference. Select a secret and use{" "}
        <span className="font-medium">Share ref</span> to send it.
      </p>
      <button onClick={onCancel} className="shrink-0 text-foreground/30 hover:text-foreground/60 transition-colors">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Main overlay ─────────────────────────────────────────────────────────────

type Tab = "vault" | "permission";

export interface VaultPermissionOverlayProps {
  entry: OverlayEntry;
  onClose: () => void;
}

export function VaultPermissionOverlay({ entry, onClose }: VaultPermissionOverlayProps) {
  const { resolvePending, cancelAllPending } = useOverlayStore();
  const [tab, setTab] = useState<Tab>(entry.kind === "permission" ? "permission" : "vault");

  const requestId = entry.payload?.requestId as string | undefined;
  const appId = entry.payload?.requestingAppId as string | undefined;
  const isPickerMode = entry.kind === "vault" && !!requestId;

  // Pressing Escape cancels any pending request
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

  const hasPermissionTab = entry.kind === "permission" || useOverlayStore.getState().stack.some((e) => e.kind === "permission");

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={handleClose}
        aria-hidden
      />

      {/* Bottom sheet */}
      <motion.div
        className="fixed inset-x-0 bottom-0 z-30 flex max-h-[72vh] flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-background shadow-2xl"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-modal
        aria-label="Vault and permissions"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex shrink-0 justify-center pt-3 pb-1">
          <span className="h-1 w-10 rounded-full bg-foreground/15" />
        </div>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-1">
          <div className="flex gap-1">
            <button
              onClick={() => setTab("vault")}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                tab === "vault"
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-foreground/45 hover:text-foreground/70"
              }`}
            >
              Vault
            </button>
            {(entry.kind === "permission" || hasPermissionTab) && (
              <button
                onClick={() => setTab("permission")}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  tab === "permission"
                    ? "bg-foreground/[0.08] text-foreground"
                    : "text-foreground/45 hover:text-foreground/70"
                }`}
              >
                Permissions
                {entry.kind === "permission" && (
                  <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[9px] font-bold text-warning-foreground">
                    1
                  </span>
                )}
              </button>
            )}
          </div>
          <button
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground/35 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/60"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "vault" && (
            <>
              {isPickerMode && appId && (
                <VaultPickerBanner appId={appId} onCancel={handleClose} />
              )}
              <div className="px-5 pb-6">
                <PodConnectGate>
                  <VaultApp onSelectRef={isPickerMode ? handleSelectRef : undefined} />
                </PodConnectGate>
              </div>
            </>
          )}

          {tab === "permission" && (
            <PermissionRequest entry={entry} onClose={onClose} />
          )}
        </div>
      </motion.div>
    </>
  );
}
