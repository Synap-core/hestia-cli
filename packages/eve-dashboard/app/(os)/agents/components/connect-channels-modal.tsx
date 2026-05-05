"use client";

/**
 * `ConnectChannelsModal` — onboarding for the three messaging surfaces
 * OpenClaw routes for the Synap pod.
 *
 * Three tabs:
 *   • Telegram  — paste the BotFather token, save → restart OpenClaw
 *   • Discord   — same shape as Telegram, OpenClaw gateway accepts the
 *                 platform enum even though the Discord.js bot in
 *                 OpenClaw itself is a separate sprint (the form here
 *                 is the upstream half — the same flow Telegram uses)
 *   • WhatsApp  — Baileys QR scan flow against the dashboard's local
 *                 session-manager singleton
 *
 * None of these are "coming soon" — every tab makes a real API call
 * and every connection is tracked end-to-end (Telegram + Discord via
 * /api/components/openclaw/messaging, WhatsApp via the new Baileys
 * routes).
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx §M3
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Tabs, Tab, Button, Input, Card, CardBody, Chip, Spinner,
} from "@heroui/react";
import {
  MessageSquare, Send, Smartphone, Check, AlertTriangle, RefreshCw,
} from "lucide-react";
import type { MessagingPlatform } from "@/lib/openclaw-config";
import type { WhatsAppStatus } from "../../../api/components/openclaw/whatsapp/session-manager";

export interface ConnectChannelsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ConnectChannelsModal({ isOpen, onClose }: ConnectChannelsModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      scrollBehavior="inside"
      backdrop="blur"
      classNames={{
        base: "bg-content1/90 backdrop-blur-pane",
        header: "border-b border-foreground/[0.06]",
        body: "py-5",
      }}
    >
      <ModalContent>
        {(closeFn) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <h2 className="text-[16px] font-medium text-foreground">
                Connect channels
              </h2>
              <p className="text-[12.5px] font-normal text-foreground/55">
                Pick where messages should reach Eve. OpenClaw forwards them to your Synap pod.
              </p>
            </ModalHeader>
            <ModalBody>
              <Tabs
                aria-label="Channel platforms"
                variant="solid"
                color="primary"
                radius="full"
                size="sm"
                classNames={{
                  tabList: "bg-foreground/[0.05] gap-1",
                  cursor: "bg-foreground/[0.10]",
                  tabContent:
                    "text-foreground/55 group-data-[selected=true]:text-foreground",
                }}
              >
                <Tab
                  key="telegram"
                  title={
                    <span className="inline-flex items-center gap-1.5 px-1">
                      <Send className="h-3.5 w-3.5" />
                      Telegram
                    </span>
                  }
                >
                  <MessagingTokenForm platform="telegram" helperLink="https://core.telegram.org/bots#botfather" />
                </Tab>
                <Tab
                  key="discord"
                  title={
                    <span className="inline-flex items-center gap-1.5 px-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Discord
                    </span>
                  }
                >
                  <MessagingTokenForm platform="discord" helperLink="https://discord.com/developers/applications" />
                </Tab>
                <Tab
                  key="whatsapp"
                  title={
                    <span className="inline-flex items-center gap-1.5 px-1">
                      <Smartphone className="h-3.5 w-3.5" />
                      WhatsApp
                    </span>
                  }
                >
                  <WhatsAppForm />
                </Tab>
              </Tabs>
            </ModalBody>
            <ModalFooter className="border-t border-foreground/[0.06]">
              <Button variant="light" radius="full" onPress={closeFn}>
                Done
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ── Telegram + Discord — same form, different platform value ────────────────

interface MessagingConfigResponse {
  enabled: boolean;
  platform?: MessagingPlatform;
  hasToken: boolean;
}

const PLATFORM_HELP: Record<"telegram" | "discord", { title: string; body: string; tokenLabel: string }> = {
  telegram: {
    title: "Connect a Telegram bot",
    body:
      "Open @BotFather in Telegram, run /newbot, and paste the bot token here. OpenClaw polls for messages on your behalf.",
    tokenLabel: "Bot token",
  },
  discord: {
    title: "Connect a Discord bot",
    body:
      "Create an application in the Discord developer portal, add a bot, and paste its token here. OpenClaw connects via the gateway.",
    tokenLabel: "Bot token",
  },
};

function MessagingTokenForm({
  platform,
  helperLink,
}: {
  platform: "telegram" | "discord";
  helperLink: string;
}) {
  const [config, setConfig] = useState<MessagingConfigResponse | null>(null);
  const [token, setToken] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const help = PLATFORM_HELP[platform];

  const isConnectedHere =
    config?.enabled === true && config.platform === platform && config.hasToken;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/components/openclaw/messaging", {
          credentials: "include",
          cache: "no-store",
        });
        if (!cancelled && res.ok) {
          setConfig(await res.json());
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save(enable: boolean) {
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/components/openclaw/messaging", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          enabled: enable,
          platform,
          // Empty token preserves; non-empty replaces.
          ...(token.trim() ? { botToken: token.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as MessagingConfigResponse;
      setConfig(next);
      setToken("");
      setSavedAt(Date.now());
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <header>
        <h3 className="text-[14px] font-medium text-foreground">{help.title}</h3>
        <p className="mt-1 text-[12.5px] text-foreground/60">
          {help.body}{" "}
          <a
            href={helperLink}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Open docs ↗
          </a>
        </p>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[12.5px] text-foreground/55">
          <Spinner size="sm" color="primary" />
          Loading current config…
        </div>
      ) : (
        <Card
          isBlurred
          shadow="none"
          radius="lg"
          classNames={{
            base: "bg-foreground/[0.04] border border-foreground/[0.08]",
          }}
        >
          <CardBody className="space-y-3 px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-medium text-foreground">Status</span>
              {isConnectedHere ? (
                <Chip size="sm" radius="full" color="success" variant="flat" startContent={<Check className="h-3 w-3" />}>
                  Connected
                </Chip>
              ) : config?.enabled && config.platform !== platform ? (
                <Chip size="sm" radius="full" color="warning" variant="flat">
                  Different platform active
                </Chip>
              ) : (
                <Chip size="sm" radius="full" variant="flat">
                  Not connected
                </Chip>
              )}
            </div>

            <Input
              type="password"
              label={help.tokenLabel}
              labelPlacement="outside"
              placeholder={isConnectedHere ? "(stored — leave blank to keep)" : "Paste your bot token"}
              value={token}
              onChange={e => setToken(e.target.value)}
              variant="flat"
              radius="md"
              size="sm"
              classNames={{
                inputWrapper: "bg-foreground/[0.04] border border-foreground/[0.08]",
              }}
            />

            {errorMsg && (
              <div className="flex items-center gap-2 text-[12px] text-danger">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {errorMsg}
              </div>
            )}

            {savedAt && !errorMsg && (
              <p className="text-[11.5px] text-foreground/55">
                Saved. Restart OpenClaw from the Components tab for changes to take effect.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                color="primary"
                radius="full"
                size="sm"
                isLoading={isSaving}
                onPress={() => void save(true)}
                isDisabled={!token.trim() && !isConnectedHere}
              >
                {isConnectedHere ? "Update" : "Connect"}
              </Button>
              {isConnectedHere && (
                <Button
                  color="default"
                  variant="flat"
                  radius="full"
                  size="sm"
                  isLoading={isSaving}
                  onPress={() => void save(false)}
                >
                  Disconnect
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ── WhatsApp — Baileys QR scan ──────────────────────────────────────────────

function WhatsAppForm() {
  const [status, setStatus] = useState<WhatsAppStatus>({ kind: "disconnected" });
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial status fetch + while in awaiting_scan/connecting, poll every 2s.
  useEffect(() => {
    let cancelled = false;
    async function fetchStatus() {
      try {
        const res = await fetch("/api/components/openclaw/whatsapp", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) setStatus((await res.json()) as WhatsAppStatus);
      } catch (e) {
        if (!cancelled) setErrorMsg(e instanceof Error ? e.message : "Network error");
      }
    }
    void fetchStatus();
    return () => { cancelled = true; };
  }, []);

  // Poll when scan/connect in progress — clear when done.
  useEffect(() => {
    const inFlight = status.kind === "awaiting_scan" || status.kind === "connecting";
    if (!inFlight) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/components/openclaw/whatsapp", {
          credentials: "include",
          cache: "no-store",
        });
        if (res.ok) setStatus((await res.json()) as WhatsAppStatus);
      } catch {
        // transient — keep polling
      }
    }, 2000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status.kind]);

  async function init() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/components/openclaw/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "init" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as WhatsAppStatus);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Couldn't start session");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/components/openclaw/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "disconnect" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as WhatsAppStatus);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Couldn't disconnect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <header>
        <h3 className="text-[14px] font-medium text-foreground">Connect WhatsApp</h3>
        <p className="mt-1 text-[12.5px] text-foreground/60">
          Scan a QR code from your phone to link Eve to your personal WhatsApp via a Web session.
          Keep your phone online — the link breaks if it's offline more than 14 days.
        </p>
      </header>

      <Card
        isBlurred
        shadow="none"
        radius="lg"
        classNames={{
          base: "bg-foreground/[0.04] border border-foreground/[0.08]",
        }}
      >
        <CardBody className="space-y-4 px-4 py-4">
          <WhatsAppStatusBlock
            status={status}
            errorMsg={errorMsg}
            busy={busy}
            onInit={init}
            onDisconnect={disconnect}
          />
        </CardBody>
      </Card>
    </div>
  );
}

function WhatsAppStatusBlock({
  status,
  errorMsg,
  busy,
  onInit,
  onDisconnect,
}: {
  status: WhatsAppStatus;
  errorMsg: string | null;
  busy: boolean;
  onInit: () => void;
  onDisconnect: () => void;
}) {
  const chip = useMemo(() => {
    switch (status.kind) {
      case "connected":
        return <Chip size="sm" radius="full" color="success" variant="flat" startContent={<Check className="h-3 w-3" />}>Connected</Chip>;
      case "awaiting_scan":
        return <Chip size="sm" radius="full" color="primary" variant="flat">Awaiting scan</Chip>;
      case "connecting":
        return <Chip size="sm" radius="full" variant="flat" startContent={<Spinner size="sm" color="default" />}>Connecting…</Chip>;
      case "error":
        return <Chip size="sm" radius="full" color="danger" variant="flat" startContent={<AlertTriangle className="h-3 w-3" />}>Error</Chip>;
      case "disconnected":
      default:
        return <Chip size="sm" radius="full" variant="flat">Not connected</Chip>;
    }
  }, [status.kind]);

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium text-foreground">Status</span>
        {chip}
      </div>

      {status.kind === "awaiting_scan" && (
        <div className="flex flex-col items-center gap-3">
          <img
            src={status.qrDataUrl}
            alt="WhatsApp QR code"
            width={240}
            height={240}
            className="rounded-lg border border-foreground/[0.08] bg-white p-2"
          />
          <ol className="text-[12px] text-foreground/65 space-y-1 list-decimal pl-5">
            <li>Open WhatsApp on your phone</li>
            <li>Settings → Linked Devices → Link a Device</li>
            <li>Point your camera at this QR code</li>
          </ol>
        </div>
      )}

      {status.kind === "connected" && (
        <p className="text-[13px] text-foreground">
          Linked as <span className="font-mono text-primary">{status.phoneNumber}</span>
        </p>
      )}

      {status.kind === "error" && (
        <div className="flex items-start gap-2 text-[12px] text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {status.message}
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 text-[12px] text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {errorMsg}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {status.kind === "disconnected" || status.kind === "error" ? (
          <Button
            color="primary"
            radius="full"
            size="sm"
            isLoading={busy}
            onPress={onInit}
          >
            Generate QR
          </Button>
        ) : status.kind === "connected" ? (
          <Button
            color="default"
            variant="flat"
            radius="full"
            size="sm"
            isLoading={busy}
            onPress={onDisconnect}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            color="default"
            variant="flat"
            radius="full"
            size="sm"
            isLoading={busy}
            startContent={<RefreshCw className="h-3.5 w-3.5" />}
            onPress={onInit}
          >
            Restart scan
          </Button>
        )}
      </div>
    </>
  );
}
