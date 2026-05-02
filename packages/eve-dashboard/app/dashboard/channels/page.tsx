"use client";

/**
 * Channels — top-level surface for enabling messaging bridges between
 * agents and the outside world (Telegram, Signal, Matrix, voice).
 *
 * Channels are powered by OpenClaw's messaging/voice config under the
 * hood — this page is just a friendlier surface than the raw "OpenClaw
 * config" tab. Each platform is a card with: status, enable toggle,
 * provider-specific settings.
 *
 * If OpenClaw isn't installed, we surface a guided install path instead
 * of the toggles — channels don't function without it.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Spinner, Switch, Select, SelectItem, Input, Button, Chip, addToast,
} from "@heroui/react";
import {
  MessagesSquare, Send, Phone, Lock, ExternalLink, RotateCcw,
} from "lucide-react";
import { IntegrationChecklist } from "../components/integration-checklist";

type MessagingPlatform = "telegram" | "signal" | "matrix";
type VoiceProvider = "twilio" | "signal" | "selfhosted";

interface MessagingConfig {
  enabled: boolean;
  platform?: MessagingPlatform;
  hasToken: boolean;
}

interface VoiceConfig {
  enabled: boolean;
  provider?: VoiceProvider;
  phoneNumber?: string;
  sipUri?: string;
}

interface ComponentSummary {
  id: string;
  installed: boolean;
}

export default function ChannelsPage() {
  const [openclawState, setOpenclawState] = useState<"unknown" | "missing" | "installed">("unknown");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/components", { credentials: "include" });
      if (!res.ok) { setOpenclawState("missing"); return; }
      const data = await res.json() as { components: ComponentSummary[] };
      const oc = data.components?.find(c => c.id === "openclaw");
      setOpenclawState(oc?.installed ? "installed" : "missing");
    })();
  }, []);

  return (
    <div className="space-y-10">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-default-500">Talk to your agents</p>
          <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
            Channels
          </h1>
          <p className="mt-1 max-w-2xl text-default-500">
            Enable messaging bridges so you can talk to your agents from anywhere —
            Telegram, Signal, Matrix, voice. Channels are powered by OpenClaw under
            the hood; settings here drive its messaging + voice config.
          </p>
        </div>
      </header>

      {openclawState === "missing" && <OpenclawMissing />}
      {openclawState === "installed" && <ChannelSurfaces />}
      {openclawState === "unknown" && (
        <div className="flex items-center gap-3 rounded-xl border border-divider bg-content1 p-4">
          <Spinner size="sm" />
          <span className="text-sm text-default-500">Checking OpenClaw…</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpenClaw missing — guided install path
// ---------------------------------------------------------------------------

function OpenclawMissing() {
  return (
    <section className="rounded-xl border border-divider bg-content1 p-6 space-y-3">
      <div className="flex items-center gap-2 text-foreground">
        <Lock className="h-4 w-4" />
        <h2 className="font-heading text-lg font-medium">OpenClaw is required</h2>
      </div>
      <p className="text-sm text-default-500 max-w-2xl">
        Channels run on OpenClaw — the agent runtime that handles inbound messages
        from Telegram / Signal / Matrix and outbound voice calls. Install it once
        and every channel below becomes available.
      </p>
      <div className="pt-1">
        <Link
          href="/dashboard/components"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Install OpenClaw
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Surfaces — the real channel toggles when OpenClaw is installed
// ---------------------------------------------------------------------------

function ChannelSurfaces() {
  return (
    <>
      <IntegrationChecklist
        integrationId="openclaw-synap"
        title="OpenClaw ↔ Synap setup"
        description="Channels won't run until OpenClaw is wired to your pod."
      />

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-medium tracking-tightest text-foreground">
          Messaging
        </h2>
        <p className="text-sm text-default-500 max-w-2xl">
          Pick one platform. OpenClaw connects to it as a bot and routes inbound
          messages to your agents. Save changes, then restart OpenClaw to apply.
        </p>
        <MessagingCard />
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-medium tracking-tightest text-foreground">
          Voice
        </h2>
        <p className="text-sm text-default-500 max-w-2xl">
          Inbound + outbound calls handled by your chosen provider. Twilio is the
          most common; self-hosted SIP works for full sovereignty.
        </p>
        <VoiceCard />
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-medium tracking-tightest text-foreground">
          Coming soon
        </h2>
        <p className="text-sm text-default-500">
          More platforms wired through the same channels surface.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ComingSoonCard name="Discord" hint="Slash commands + DM bridge" />
          <ComingSoonCard name="WhatsApp" hint="Cloud API + business number" />
          <ComingSoonCard name="Slack" hint="Workspace bot + DM bridge" />
          <ComingSoonCard name="iMessage" hint="Self-hosted Mac bridge" />
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Messaging card
// ---------------------------------------------------------------------------

function MessagingCard() {
  const [cfg, setCfg] = useState<MessagingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState("");
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/components/openclaw/messaging", { credentials: "include" });
      if (res.ok) setCfg(await res.json());
      setLoading(false);
    })();
  }, []);

  const onSave = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch("/api/components/openclaw/messaging", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          enabled: cfg.enabled,
          platform: cfg.platform,
          botToken: token.length > 0 ? token : undefined,
        }),
      });
      if (res.ok) {
        const next = await res.json() as MessagingConfig & { restartNeeded?: boolean };
        setCfg(next);
        setToken("");
        setRestartNeeded(true);
        addToast({ title: "Saved · restart OpenClaw to apply", color: "success" });
      }
    } finally { setSaving(false); }
  }, [cfg, token]);

  const onRestart = useCallback(async () => {
    // `recreate` (not `restart`) is what actually re-applies new env from
    // secrets.json — `docker restart` keeps the stale env from the original
    // `docker run`. The lifecycle's recreate action does `docker rm -f` +
    // `docker run` with the current secrets values.
    setRestarting(true);
    try {
      const res = await fetch("/api/components/openclaw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "recreate" }),
      });
      if (res.ok) {
        setRestartNeeded(false);
        addToast({ title: "OpenClaw recreated · new config applied", color: "success" });
      } else {
        addToast({ title: "Recreate failed", color: "danger" });
      }
    } finally { setRestarting(false); }
  }, []);

  if (loading || !cfg) {
    return (
      <div className="rounded-xl border border-divider bg-content1 p-6 flex items-center gap-3">
        <Spinner size="sm" /><span className="text-sm text-default-500">Loading…</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-divider bg-content1 p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-content2 p-2 text-default-500">
            <Send className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Messaging bridge</p>
            <p className="text-xs text-default-500">
              {cfg.enabled
                ? `${cfg.platform ? cfg.platform.charAt(0).toUpperCase() + cfg.platform.slice(1) : "Platform"} · ${cfg.hasToken ? "token stored" : "needs token"}`
                : "Disabled"}
            </p>
          </div>
        </div>
        <Chip
          size="sm"
          variant="flat"
          color={cfg.enabled && cfg.hasToken ? "success" : cfg.enabled ? "warning" : "default"}
          radius="sm"
        >
          {cfg.enabled && cfg.hasToken ? "Active" : cfg.enabled ? "Token missing" : "Off"}
        </Chip>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          size="sm"
          isSelected={cfg.enabled}
          onValueChange={(v) => setCfg({ ...cfg, enabled: v })}
        />
        <span className="text-sm text-foreground">Enable bridge</span>
      </div>

      <Select
        size="sm"
        variant="bordered"
        label="Platform"
        labelPlacement="outside"
        selectedKeys={cfg.platform ? new Set([cfg.platform]) : new Set()}
        onSelectionChange={(keys) => {
          const v = Array.from(keys)[0] as MessagingPlatform | undefined;
          setCfg({ ...cfg, platform: v });
        }}
      >
        <SelectItem key="telegram">Telegram</SelectItem>
        <SelectItem key="signal">Signal</SelectItem>
        <SelectItem key="matrix">Matrix</SelectItem>
      </Select>

      <Input
        size="sm"
        variant="bordered"
        type="password"
        label={cfg.hasToken ? "Bot token (leave blank to keep current)" : "Bot token"}
        labelPlacement="outside"
        placeholder={cfg.hasToken ? "•••••••••• stored" : "Paste bot token"}
        description={
          cfg.platform === "telegram"
            ? "Get a token from @BotFather on Telegram."
            : cfg.platform === "signal"
            ? "Use a registered Signal number's phone link token."
            : cfg.platform === "matrix"
            ? "Matrix access token for the bot account."
            : undefined
        }
        value={token}
        onValueChange={setToken}
      />

      <div className="flex items-center justify-between gap-3">
        {restartNeeded ? (
          <Button
            size="sm"
            variant="bordered"
            radius="md"
            color="warning"
            startContent={!restarting ? <RotateCcw className="h-3.5 w-3.5" /> : undefined}
            isLoading={restarting}
            onPress={() => void onRestart()}
          >
            Apply (recreate OpenClaw)
          </Button>
        ) : <span />}
        <Button
          size="sm"
          color="primary"
          radius="md"
          isLoading={saving}
          onPress={() => void onSave()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice card
// ---------------------------------------------------------------------------

function VoiceCard() {
  const [cfg, setCfg] = useState<VoiceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/components/openclaw/voice", { credentials: "include" });
      if (res.ok) setCfg(await res.json());
      setLoading(false);
    })();
  }, []);

  const onSave = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch("/api/components/openclaw/voice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(cfg),
      });
      if (res.ok) {
        addToast({ title: "Saved · restart OpenClaw to apply", color: "success" });
      }
    } finally { setSaving(false); }
  }, [cfg]);

  if (loading || !cfg) {
    return (
      <div className="rounded-xl border border-divider bg-content1 p-6 flex items-center gap-3">
        <Spinner size="sm" /><span className="text-sm text-default-500">Loading…</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-divider bg-content1 p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-content2 p-2 text-default-500">
            <Phone className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Voice channel</p>
            <p className="text-xs text-default-500">
              {cfg.enabled
                ? `${cfg.provider ?? "Provider"} · ${cfg.phoneNumber ?? cfg.sipUri ?? "unset"}`
                : "Disabled"}
            </p>
          </div>
        </div>
        <Chip
          size="sm"
          variant="flat"
          color={cfg.enabled ? "success" : "default"}
          radius="sm"
        >
          {cfg.enabled ? "Active" : "Off"}
        </Chip>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          size="sm"
          isSelected={cfg.enabled}
          onValueChange={(v) => setCfg({ ...cfg, enabled: v })}
        />
        <span className="text-sm text-foreground">Enable voice</span>
      </div>

      <Select
        size="sm"
        variant="bordered"
        label="Provider"
        labelPlacement="outside"
        selectedKeys={cfg.provider ? new Set([cfg.provider]) : new Set()}
        onSelectionChange={(keys) => {
          const v = Array.from(keys)[0] as VoiceProvider | undefined;
          setCfg({ ...cfg, provider: v });
        }}
      >
        <SelectItem key="twilio">Twilio</SelectItem>
        <SelectItem key="signal">Signal</SelectItem>
        <SelectItem key="selfhosted">Self-hosted SIP</SelectItem>
      </Select>

      {cfg.provider === "twilio" && (
        <Input
          size="sm"
          variant="bordered"
          label="Phone number"
          labelPlacement="outside"
          placeholder="+15551234567"
          value={cfg.phoneNumber ?? ""}
          onValueChange={(v) => setCfg({ ...cfg, phoneNumber: v })}
        />
      )}
      {cfg.provider === "selfhosted" && (
        <Input
          size="sm"
          variant="bordered"
          label="SIP URI"
          labelPlacement="outside"
          placeholder="sip:bot@example.com"
          value={cfg.sipUri ?? ""}
          onValueChange={(v) => setCfg({ ...cfg, sipUri: v })}
        />
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          color="primary"
          radius="md"
          isLoading={saving}
          onPress={() => void onSave()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coming-soon stub
// ---------------------------------------------------------------------------

function ComingSoonCard({ name, hint }: { name: string; hint: string }) {
  return (
    <div className="rounded-xl border border-divider bg-content2/40 p-4 flex items-center justify-between gap-3 opacity-70">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-content2 p-2 text-default-500">
          <MessagesSquare className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{name}</p>
          <p className="text-xs text-default-500">{hint}</p>
        </div>
      </div>
      <Chip size="sm" variant="flat" radius="sm">Soon</Chip>
    </div>
  );
}
