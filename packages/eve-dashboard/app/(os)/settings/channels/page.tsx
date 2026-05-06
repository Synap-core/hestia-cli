"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Button, Input, Switch, Chip, addToast, Select, SelectItem,
} from "@heroui/react";
import {
  MessageSquare, Save, Eye, EyeOff, RefreshCw, ExternalLink, Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = "telegram" | "discord" | "whatsapp" | "signal" | "matrix" | "slack";

interface TelegramConfig {
  enabled: boolean;
  hasToken: boolean;
  tokenMasked?: string;
  hasWebhookSecret: boolean;
}

interface DiscordConfig {
  enabled: boolean;
  hasToken: boolean;
  tokenMasked?: string;
  guildId?: string | null;
  applicationId?: string | null;
}

interface WhatsappConfig {
  enabled: boolean;
  phoneNumberId?: string | null;
  hasAccessToken: boolean;
  accessTokenMasked?: string;
  hasVerifyToken: boolean;
}

interface SignalConfig {
  enabled: boolean;
  phoneNumber?: string | null;
  apiUrl?: string | null;
}

interface MatrixConfig {
  enabled: boolean;
  homeserverUrl?: string | null;
  hasAccessToken: boolean;
  accessTokenMasked?: string;
  roomId?: string | null;
}

interface SlackConfig {
  enabled: boolean;
  hasToken: boolean;
  tokenMasked?: string;
  hasSigningSecret: boolean;
  hasAppToken: boolean;
}

interface ChannelsState {
  routing: Partial<Record<Platform, string>>;
  telegram: TelegramConfig;
  discord: DiscordConfig;
  whatsapp: WhatsappConfig;
  signal: SignalConfig;
  matrix: MatrixConfig;
  slack: SlackConfig;
}

// ---------------------------------------------------------------------------
// Agent options for routing selector
// ---------------------------------------------------------------------------

const AGENT_OPTIONS = [
  { key: "hermes",   label: "Hermes (recommended)" },
  { key: "openclaw", label: "OpenClaw (legacy)" },
];

// ---------------------------------------------------------------------------
// Platform card
// ---------------------------------------------------------------------------

const PLATFORM_META: Record<Platform, { label: string; emoji: string; description: string }> = {
  telegram:  { label: "Telegram",  emoji: "✈️",  description: "Bot API · webhook or long-poll" },
  discord:   { label: "Discord",   emoji: "🎮",  description: "Bot token · slash commands" },
  whatsapp:  { label: "WhatsApp",  emoji: "💬",  description: "Cloud API (Meta Business)" },
  signal:    { label: "Signal",    emoji: "🔒",  description: "signal-cli self-hosted bridge" },
  matrix:    { label: "Matrix",    emoji: "🔷",  description: "Element / Synapse homeserver" },
  slack:     { label: "Slack",     emoji: "💼",  description: "Bolt app · socket mode" },
};

// Per-platform setup guidance shown in every card
const PLATFORM_HELP: Record<Platform, { tip: string; link?: string; linkLabel?: string; testable?: boolean }> = {
  telegram: {
    tip: "Create a bot with @BotFather on Telegram to get your token. Hermes uses long polling — no webhook URL configuration needed.",
    link: "https://t.me/BotFather",
    linkLabel: "Open BotFather",
    testable: true,
  },
  discord: {
    tip: "Create an application, add a Bot, and copy the token from the Bot tab. Enable the Message Content Intent for Hermes to read messages.",
    link: "https://discord.com/developers/applications",
    linkLabel: "Discord Developer Portal",
  },
  whatsapp: {
    tip: "Cloud API (Meta) requires Business verification (1–4 weeks). For personal use without verification, use the WhatsApp tab in Agents instead.",
    link: "/agents",
    linkLabel: "Go to Agents → WhatsApp",
  },
  signal: {
    tip: "Requires a self-hosted signal-cli REST bridge running on your network. Register your phone number with signal-cli first.",
    link: "https://github.com/bbernhard/signal-cli-rest-api",
    linkLabel: "signal-cli REST API",
  },
  matrix: {
    tip: "Create a bot account on your homeserver. Copy its access token from Element → Settings → Help & About → Access Token.",
  },
  slack: {
    tip: "Create a Slack app, add Bot Token Scopes, and enable Socket Mode to get an App Token. Both tokens are required.",
    link: "https://api.slack.com/apps",
    linkLabel: "Slack API Console",
  },
};

// Platforms for which a test-connection API call is supported
const TESTABLE_PLATFORMS = new Set<Platform>(["telegram"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function MaskedInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      type={visible ? "text" : "password"}
      value={value}
      onValueChange={onChange}
      placeholder={placeholder}
      size="sm"
      endContent={
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          className="text-foreground/40 hover:text-foreground/70 transition-colors"
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ChannelsPage() {
  const [config, setConfig] = useState<ChannelsState | null>(null);
  const [loading, setLoading] = useState(true);

  // Draft edit state per platform
  const [drafts, setDrafts] = useState<Partial<Record<Platform, Record<string, string>>>>({});
  const [saving, setSaving] = useState<Partial<Record<Platform | "routing", boolean>>>({});
  const [testing, setTesting] = useState<Partial<Record<Platform, boolean>>>({});

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/channels");
      if (!res.ok) throw new Error("Failed to load channel config");
      const data = await res.json() as ChannelsState;
      setConfig(data);
      setDrafts({});
    } catch {
      addToast({ title: "Could not load channels", color: "danger" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchConfig(); }, [fetchConfig]);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function savePlatform(platform: Platform, patch: Record<string, unknown>) {
    setSaving(s => ({ ...s, [platform]: true }));
    try {
      const res = await fetch("/api/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [platform]: patch }),
      });
      if (!res.ok) throw new Error("Save failed");
      const { hermesRestarted } = await res.json() as { ok: boolean; hermesRestarted?: boolean };
      addToast({
        title: `${PLATFORM_META[platform].label} saved`,
        description: hermesRestarted
          ? "Hermes restarted — new credentials active"
          : "Saved (start Hermes to apply)",
        color: "success",
      });
      setDrafts(d => { const n = { ...d }; delete n[platform]; return n; });
      await fetchConfig();
    } catch {
      addToast({ title: "Save failed", color: "danger" });
    } finally {
      setSaving(s => ({ ...s, [platform]: false }));
    }
  }

  async function testPlatform(platform: Platform) {
    setTesting(t => ({ ...t, [platform]: true }));
    try {
      const res = await fetch("/api/channels/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json() as { ok: boolean; name?: string; username?: string; error?: string };
      if (data.ok) {
        addToast({
          title: `Connected as @${data.username ?? data.name ?? "bot"}`,
          color: "success",
        });
      } else {
        addToast({ title: `Connection failed: ${data.error ?? "unknown"}`, color: "danger" });
      }
    } catch {
      addToast({ title: "Test failed — could not reach server", color: "danger" });
    } finally {
      setTesting(t => ({ ...t, [platform]: false }));
    }
  }

  async function saveRouting(platform: Platform, agent: string | null) {
    setSaving(s => ({ ...s, routing: true }));
    try {
      const res = await fetch("/api/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routing: { [platform]: agent } }),
      });
      if (!res.ok) throw new Error("Save failed");
      addToast({ title: "Routing updated", color: "success" });
      await fetchConfig();
    } catch {
      addToast({ title: "Routing save failed", color: "danger" });
    } finally {
      setSaving(s => ({ ...s, routing: false }));
    }
  }

  async function toggleEnabled(platform: Platform, enabled: boolean) {
    await savePlatform(platform, { enabled });
  }

  // Draft helpers
  function draft(platform: Platform, key: string, value: string) {
    setDrafts(d => ({
      ...d,
      [platform]: { ...(d[platform] ?? {}), [key]: value },
    }));
  }
  function draftVal(platform: Platform, key: string): string {
    return drafts[platform]?.[key] ?? "";
  }
  function hasDraft(platform: Platform): boolean {
    return Object.keys(drafts[platform] ?? {}).length > 0;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center p-16 text-foreground/40">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        Loading channels…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Messaging Channels
        </h2>
        <p className="text-xs text-foreground/50 mt-1">
          Credentials stored centrally — change the routing to switch agent providers without touching
          tokens. Default agent is <span className="font-medium text-foreground/70">Hermes</span>.
        </p>
      </div>

      {/* Per-platform cards */}
      {(Object.keys(PLATFORM_META) as Platform[]).map(platform => {
        const meta = PLATFORM_META[platform];
        const help = PLATFORM_HELP[platform];
        const isEnabled = config[platform].enabled;
        const routingAgent = config.routing[platform] ?? "hermes";
        const savingThis = saving[platform] ?? false;
        const testingThis = testing[platform] ?? false;
        const platformCfg = config[platform] as unknown as Record<string, unknown>;
        const canTest = TESTABLE_PLATFORMS.has(platform) && (platformCfg.hasToken === true) && !hasDraft(platform);

        return (
          <section
            key={platform}
            className="rounded-xl border border-foreground/[0.07] bg-content1 overflow-hidden"
          >
            {/* Platform header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/[0.06]">
              <div className="flex items-center gap-2">
                <span className="text-base">{meta.emoji}</span>
                <div>
                  <p className="text-sm font-medium text-foreground">{meta.label}</p>
                  <p className="text-[11px] text-foreground/40">{meta.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canTest && (
                  <Button
                    size="sm"
                    variant="flat"
                    isLoading={testingThis}
                    startContent={!testingThis && <Zap className="h-3 w-3" />}
                    onPress={() => void testPlatform(platform)}
                    className="h-6 min-w-0 px-2 text-[11px]"
                  >
                    Test
                  </Button>
                )}
                {isEnabled && (
                  <Chip size="sm" variant="flat" color="success" classNames={{ base: "h-5", content: "text-[10px] px-1.5" }}>
                    Active
                  </Chip>
                )}
                <Switch
                  size="sm"
                  isSelected={isEnabled}
                  onValueChange={v => void toggleEnabled(platform, v)}
                />
              </div>
            </div>

            {/* Credentials + routing (always visible so users can fill before enabling) */}
            <div className="px-4 py-4 space-y-3">
              {/* Routing selector */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-foreground/50 shrink-0 w-28">Route to agent</span>
                <Select
                  size="sm"
                  selectedKeys={[routingAgent]}
                  onSelectionChange={keys => {
                    const key = Array.from(keys)[0] as string;
                    void saveRouting(platform, key === "hermes" ? null : key);
                  }}
                  aria-label="Agent routing"
                  className="max-w-[200px]"
                >
                  {AGENT_OPTIONS.map(o => (
                    <SelectItem key={o.key}>{o.label}</SelectItem>
                  ))}
                </Select>
              </div>

              {/* Platform-specific credential fields */}
              <PlatformFields
                platform={platform}
                config={config}
                draftVal={(k) => draftVal(platform, k)}
                draft={(k, v) => draft(platform, k, v)}
              />

              {/* Setup help */}
              <div className="rounded-lg bg-content2/60 px-3 py-2 space-y-1">
                <p className="text-[11px] text-foreground/50 leading-relaxed">{help.tip}</p>
                {help.link && (
                  <a
                    href={help.link}
                    target={help.link.startsWith("http") ? "_blank" : undefined}
                    rel={help.link.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {help.linkLabel}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {/* Save button (only when there are draft changes) */}
              {hasDraft(platform) && (
                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    isLoading={savingThis}
                    startContent={!savingThis && <Save className="h-3.5 w-3.5" />}
                    onPress={() => void savePlatform(platform, drafts[platform] ?? {})}
                  >
                    Save {meta.label}
                  </Button>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform-specific fields
// ---------------------------------------------------------------------------

function PlatformFields({
  platform,
  config,
  draftVal,
  draft,
}: {
  platform: Platform;
  config: ChannelsState;
  draftVal: (key: string) => string;
  draft: (key: string, value: string) => void;
}) {
  const row = (label: string, node: React.ReactNode) => (
    <div key={label} className="flex items-center gap-3">
      <span className="text-xs text-foreground/50 shrink-0 w-28">{label}</span>
      <div className="flex-1">{node}</div>
    </div>
  );

  switch (platform) {
    case "telegram":
      return (
        <>
          {row("Bot token", (
            <MaskedInput
              value={draftVal("botToken")}
              onChange={v => draft("botToken", v)}
              placeholder={config.telegram.hasToken ? config.telegram.tokenMasked : "1234567890:ABC..."}
            />
          ))}
          {row("Webhook secret", (
            <MaskedInput
              value={draftVal("webhookSecret")}
              onChange={v => draft("webhookSecret", v)}
              placeholder={config.telegram.hasWebhookSecret ? "••••••••" : "optional"}
            />
          ))}
        </>
      );

    case "discord":
      return (
        <>
          {row("Bot token", (
            <MaskedInput
              value={draftVal("botToken")}
              onChange={v => draft("botToken", v)}
              placeholder={config.discord.hasToken ? config.discord.tokenMasked : "MTI…"}
            />
          ))}
          {row("Guild ID", (
            <Input
              size="sm"
              value={draftVal("guildId")}
              onValueChange={v => draft("guildId", v)}
              placeholder={config.discord.guildId ?? "optional"}
            />
          ))}
          {row("Application ID", (
            <Input
              size="sm"
              value={draftVal("applicationId")}
              onValueChange={v => draft("applicationId", v)}
              placeholder={config.discord.applicationId ?? "optional"}
            />
          ))}
        </>
      );

    case "whatsapp":
      return (
        <>
          {row("Phone number ID", (
            <Input
              size="sm"
              value={draftVal("phoneNumberId")}
              onValueChange={v => draft("phoneNumberId", v)}
              placeholder={config.whatsapp.phoneNumberId ?? "1234567890"}
            />
          ))}
          {row("Access token", (
            <MaskedInput
              value={draftVal("accessToken")}
              onChange={v => draft("accessToken", v)}
              placeholder={config.whatsapp.hasAccessToken ? config.whatsapp.accessTokenMasked : "EAA…"}
            />
          ))}
          {row("Verify token", (
            <MaskedInput
              value={draftVal("verifyToken")}
              onChange={v => draft("verifyToken", v)}
              placeholder={config.whatsapp.hasVerifyToken ? "••••••••" : "webhook verify token"}
            />
          ))}
        </>
      );

    case "signal":
      return (
        <>
          {row("Phone number", (
            <Input
              size="sm"
              value={draftVal("phoneNumber")}
              onValueChange={v => draft("phoneNumber", v)}
              placeholder={config.signal.phoneNumber ?? "+1234567890"}
            />
          ))}
          {row("API URL", (
            <Input
              size="sm"
              value={draftVal("apiUrl")}
              onValueChange={v => draft("apiUrl", v)}
              placeholder={config.signal.apiUrl ?? "http://signal-cli:8080"}
            />
          ))}
        </>
      );

    case "matrix":
      return (
        <>
          {row("Homeserver URL", (
            <Input
              size="sm"
              value={draftVal("homeserverUrl")}
              onValueChange={v => draft("homeserverUrl", v)}
              placeholder={config.matrix.homeserverUrl ?? "https://matrix.example.com"}
            />
          ))}
          {row("Access token", (
            <MaskedInput
              value={draftVal("accessToken")}
              onChange={v => draft("accessToken", v)}
              placeholder={config.matrix.hasAccessToken ? config.matrix.accessTokenMasked : "syt_…"}
            />
          ))}
          {row("Room ID", (
            <Input
              size="sm"
              value={draftVal("roomId")}
              onValueChange={v => draft("roomId", v)}
              placeholder={config.matrix.roomId ?? "!room:example.com"}
            />
          ))}
        </>
      );

    case "slack":
      return (
        <>
          {row("Bot token", (
            <MaskedInput
              value={draftVal("botToken")}
              onChange={v => draft("botToken", v)}
              placeholder={config.slack.hasToken ? config.slack.tokenMasked : "xoxb-…"}
            />
          ))}
          {row("Signing secret", (
            <MaskedInput
              value={draftVal("signingSecret")}
              onChange={v => draft("signingSecret", v)}
              placeholder={config.slack.hasSigningSecret ? "••••••••" : "abc123…"}
            />
          ))}
          {row("App token", (
            <MaskedInput
              value={draftVal("appToken")}
              onChange={v => draft("appToken", v)}
              placeholder={config.slack.hasAppToken ? "••••••••" : "xapp-… (socket mode)"}
            />
          ))}
        </>
      );

    default:
      return null;
  }
}
