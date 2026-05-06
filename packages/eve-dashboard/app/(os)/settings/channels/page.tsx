"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Button, Input, Switch, Chip, addToast, Select, SelectItem,
} from "@heroui/react";
import {
  Eye, EyeOff, RefreshCw, ExternalLink, Zap, Save, MessageSquare,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = "telegram" | "discord" | "whatsapp" | "signal" | "matrix" | "slack";

interface TelegramConfig  { enabled: boolean; hasToken: boolean; tokenMasked?: string; hasWebhookSecret: boolean }
interface DiscordConfig   { enabled: boolean; hasToken: boolean; tokenMasked?: string; guildId?: string | null; applicationId?: string | null }
interface WhatsappConfig  { enabled: boolean; phoneNumberId?: string | null; hasAccessToken: boolean; accessTokenMasked?: string; hasVerifyToken: boolean }
interface SignalConfig    { enabled: boolean; phoneNumber?: string | null; apiUrl?: string | null }
interface MatrixConfig    { enabled: boolean; homeserverUrl?: string | null; hasAccessToken: boolean; accessTokenMasked?: string; roomId?: string | null }
interface SlackConfig     { enabled: boolean; hasToken: boolean; tokenMasked?: string; hasSigningSecret: boolean; hasAppToken: boolean }

interface ChannelsState {
  routing: Partial<Record<Platform, string>>;
  telegram: TelegramConfig;
  discord:  DiscordConfig;
  whatsapp: WhatsappConfig;
  signal:   SignalConfig;
  matrix:   MatrixConfig;
  slack:    SlackConfig;
}

// ---------------------------------------------------------------------------
// Brand icons (inline SVG — no extra package)
// ---------------------------------------------------------------------------

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.102.132 18.12a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
    </svg>
  );
}

function SignalIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.077a7.923 7.923 0 1 1 0 15.846A7.923 7.923 0 0 1 12 4.077zm-4.808 3.116a7.888 7.888 0 0 0-1.038 3.807H4.077a7.927 7.927 0 0 1 1.731-4.906l1.384 1.099zm9.616 0 1.384-1.099a7.927 7.927 0 0 1 1.731 4.906h-2.077a7.888 7.888 0 0 0-1.038-3.807zM7.192 16.807l-1.384 1.099A7.927 7.927 0 0 1 4.077 13h2.077a7.888 7.888 0 0 0 1.038 3.807zm9.616 0a7.888 7.888 0 0 0 1.038-3.807h2.077a7.927 7.927 0 0 1-1.731 4.906l-1.384-1.099z"/>
    </svg>
  );
}

function MatrixIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M.632.55v22.9H2.28V24H0V0h2.28v.55zm7.043 7.26v1.157h.033c.309-.443.683-.784 1.117-1.024.433-.245.936-.365 1.5-.365.54 0 1.033.107 1.481.314.448.208.785.582 1.02 1.108.254-.374.6-.706 1.034-.992.434-.287.95-.43 1.546-.43.453 0 .872.056 1.26.167.388.11.716.286.993.53.276.244.49.559.646.951.152.392.23.863.23 1.417v5.728h-2.349V11.52c0-.286-.01-.559-.032-.812a1.755 1.755 0 0 0-.14-.66 1.012 1.012 0 0 0-.425-.448c-.194-.11-.457-.166-.785-.166-.332 0-.6.064-.803.189a1.38 1.38 0 0 0-.48.499 1.946 1.946 0 0 0-.231.696 5.56 5.56 0 0 0-.06.836v4.934h-2.349v-4.81c0-.257-.005-.510-.015-.759a2.06 2.06 0 0 0-.115-.666 1.005 1.005 0 0 0-.376-.475c-.181-.12-.447-.181-.800-.181-.109 0-.248.023-.417.07a1.24 1.24 0 0 0-.451.247 1.38 1.38 0 0 0-.347.5c-.09.215-.136.490-.136.822v5.252H5.327V7.81zm15.693 15.64V.55H21.72V0H24v24h-2.28v-.55z"/>
    </svg>
  );
}

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Platform metadata
// ---------------------------------------------------------------------------

type PlatformMeta = {
  label: string;
  description: string;
  color: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const PLATFORM_META: Record<Platform, PlatformMeta> = {
  telegram:  { label: "Telegram",  description: "Bot API · long polling",            color: "#2AABEE", Icon: TelegramIcon  },
  discord:   { label: "Discord",   description: "Bot token · slash commands",         color: "#5865F2", Icon: DiscordIcon   },
  whatsapp:  { label: "WhatsApp",  description: "Cloud API (Meta Business)",          color: "#25D366", Icon: WhatsAppIcon  },
  signal:    { label: "Signal",    description: "signal-cli self-hosted bridge",       color: "#3A76F0", Icon: SignalIcon    },
  matrix:    { label: "Matrix",    description: "Element / Synapse homeserver",        color: "#0DBD8B", Icon: MatrixIcon    },
  slack:     { label: "Slack",     description: "Bolt app · socket mode",             color: "#4A154B", Icon: SlackIcon     },
};

const PLATFORM_HELP: Record<Platform, { tip: string; link?: string; linkLabel?: string }> = {
  telegram: {
    tip: "Create a bot with @BotFather. Hermes uses long polling — no webhook URL needed.",
    link: "https://t.me/BotFather",
    linkLabel: "Open BotFather",
  },
  discord: {
    tip: "Create an application → add a Bot → copy the token. Enable Message Content Intent for Hermes to read messages.",
    link: "https://discord.com/developers/applications",
    linkLabel: "Discord Developer Portal",
  },
  whatsapp: {
    tip: "Cloud API requires Meta Business verification (1–4 weeks). For personal use, set up WhatsApp from the Agents page instead.",
    link: "/agents",
    linkLabel: "Go to Agents → WhatsApp",
  },
  signal: {
    tip: "Requires a self-hosted signal-cli REST bridge. Register your phone number with signal-cli before connecting.",
    link: "https://github.com/bbernhard/signal-cli-rest-api",
    linkLabel: "signal-cli REST API",
  },
  matrix: {
    tip: "Create a bot account on your homeserver. Copy its access token from Element → Settings → Help & About.",
  },
  slack: {
    tip: "Create a Slack app, add Bot Token Scopes, and enable Socket Mode to get an App Token. Both tokens are required.",
    link: "https://api.slack.com/apps",
    linkLabel: "Slack API Console",
  },
};

// Credential keys whose presence indicates the platform is "configured"
const CRED_KEYS: Record<Platform, string[]> = {
  telegram:  ["botToken", "webhookSecret"],
  discord:   ["botToken"],
  whatsapp:  ["accessToken", "verifyToken"],
  signal:    [],
  matrix:    ["accessToken"],
  slack:     ["botToken", "signingSecret", "appToken"],
};

const TESTABLE_PLATFORMS = new Set<Platform>(["telegram"]);

const AGENT_OPTIONS = [
  { key: "hermes",   label: "Hermes (recommended)" },
  { key: "openclaw", label: "OpenClaw (legacy)" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function MaskedInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
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
  const [drafts, setDrafts] = useState<Partial<Record<Platform, Record<string, string>>>>({});
  const [saving, setSaving] = useState<Partial<Record<Platform | "routing", boolean>>>({});
  const [testing, setTesting] = useState<Partial<Record<Platform, boolean>>>({});

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/channels");
      if (!res.ok) throw new Error();
      setConfig(await res.json() as ChannelsState);
      setDrafts({});
    } catch {
      addToast({ title: "Could not load channels", color: "danger" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchConfig(); }, [fetchConfig]);

  async function savePlatform(platform: Platform) {
    const rawDraft = drafts[platform] ?? {};

    // Strip empty-string values — don't send blanks that would clear existing creds
    const patch: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawDraft)) {
      if (v.trim()) patch[k] = v.trim();
    }

    if (Object.keys(patch).length === 0) {
      addToast({ title: "Nothing to save — fill in at least one field", color: "warning" });
      return;
    }

    setSaving(s => ({ ...s, [platform]: true }));
    try {
      const res = await fetch("/api/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [platform]: patch }),
      });
      if (!res.ok) throw new Error();
      const { credentialsChanged, hermesRestarted } = await res.json() as {
        ok: boolean; credentialsChanged: boolean; hermesRewired?: boolean; hermesRestarted?: boolean;
      };
      addToast({
        title: `${PLATFORM_META[platform].label} saved`,
        description: credentialsChanged
          ? hermesRestarted
            ? "New credentials applied — Hermes restarted"
            : "Credentials saved — start Hermes to apply"
          : "Settings updated",
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
        addToast({ title: `Connected as @${data.username ?? data.name ?? "bot"}`, color: "success" });
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
      if (!res.ok) throw new Error();
      addToast({ title: "Routing updated", color: "success" });
      await fetchConfig();
    } catch {
      addToast({ title: "Routing save failed", color: "danger" });
    } finally {
      setSaving(s => ({ ...s, routing: false }));
    }
  }

  async function toggleEnabled(platform: Platform, enabled: boolean) {
    // Enable/disable doesn't touch credentials — no Hermes restart
    setSaving(s => ({ ...s, [platform]: true }));
    try {
      const res = await fetch("/api/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [platform]: { enabled } }),
      });
      if (!res.ok) throw new Error();
      await fetchConfig();
    } catch {
      addToast({ title: "Toggle failed", color: "danger" });
    } finally {
      setSaving(s => ({ ...s, [platform]: false }));
    }
  }

  function draft(platform: Platform, key: string, value: string) {
    setDrafts(d => ({ ...d, [platform]: { ...(d[platform] ?? {}), [key]: value } }));
  }
  function draftVal(platform: Platform, key: string): string {
    return drafts[platform]?.[key] ?? "";
  }
  function hasDraft(platform: Platform): boolean {
    return Object.values(drafts[platform] ?? {}).some(v => v.trim().length > 0);
  }
  function draftHasCredentialChange(platform: Platform): boolean {
    const d = drafts[platform];
    if (!d) return false;
    return CRED_KEYS[platform].some(k => !!d[k]?.trim());
  }

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center p-16 text-foreground/40">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        Loading channels…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Messaging Channels
        </h2>
        <p className="text-xs text-foreground/50 mt-1">
          Credentials are stored centrally — change the routing to switch agent without touching tokens.
          Default agent is <span className="font-medium text-foreground/70">Hermes</span>.
        </p>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {(Object.keys(PLATFORM_META) as Platform[]).map(platform => {
          const { label, description, color, Icon } = PLATFORM_META[platform];
          const help = PLATFORM_HELP[platform];
          const isEnabled = config[platform].enabled;
          const routingAgent = config.routing[platform] ?? "hermes";
          const savingThis = saving[platform] ?? false;
          const testingThis = testing[platform] ?? false;
          const platformCfg = config[platform] as unknown as Record<string, unknown>;
          const hasExistingCred = CRED_KEYS[platform].length === 0 || platformCfg.hasToken === true || platformCfg.hasAccessToken === true;
          const canTest = TESTABLE_PLATFORMS.has(platform) && hasExistingCred && !hasDraft(platform);
          const willRestart = draftHasCredentialChange(platform);

          return (
            <section
              key={platform}
              className="rounded-xl border border-foreground/[0.07] bg-content1 overflow-hidden flex flex-col"
            >
              {/* Header row */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-foreground/[0.06]">
                {/* Brand icon badge */}
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: color }}
                >
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-none">{label}</p>
                  <p className="text-[11px] text-foreground/40 mt-0.5">{description}</p>
                </div>
                {isEnabled && (
                  <Chip size="sm" variant="flat" color="success" classNames={{ base: "h-5", content: "text-[10px] px-1.5" }}>
                    Active
                  </Chip>
                )}
                <Switch
                  size="sm"
                  isSelected={isEnabled}
                  isDisabled={savingThis}
                  onValueChange={v => void toggleEnabled(platform, v)}
                />
              </div>

              {/* Credential fields */}
              <div className="px-4 pt-3 pb-2 space-y-2.5 flex-1">
                <PlatformFields
                  platform={platform}
                  config={config}
                  draftVal={(k) => draftVal(platform, k)}
                  draft={(k, v) => draft(platform, k, v)}
                />
              </div>

              {/* Setup tip */}
              <div className="px-4 pb-3">
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
              </div>

              {/* Footer: routing + actions */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-t border-foreground/[0.05] bg-content2/30">
                {/* Routing selector */}
                <Select
                  size="sm"
                  selectedKeys={[routingAgent]}
                  onSelectionChange={keys => {
                    const key = Array.from(keys)[0] as string;
                    void saveRouting(platform, key === "hermes" ? null : key);
                  }}
                  aria-label="Agent routing"
                  className="max-w-[175px]"
                  classNames={{ trigger: "h-7 min-h-7 text-[11px]" }}
                >
                  {AGENT_OPTIONS.map(o => (
                    <SelectItem key={o.key} className="text-xs">{o.label}</SelectItem>
                  ))}
                </Select>

                <div className="flex-1" />

                {/* Restart hint */}
                {willRestart && (
                  <p className="text-[10px] text-warning/80">
                    Hermes will restart
                  </p>
                )}

                {/* Test */}
                {canTest && (
                  <Button
                    size="sm"
                    variant="flat"
                    isLoading={testingThis}
                    startContent={!testingThis && <Zap className="h-3 w-3" />}
                    onPress={() => void testPlatform(platform)}
                    className="h-7 min-w-0 px-2.5 text-[11px]"
                  >
                    Test
                  </Button>
                )}

                {/* Save (only when draft) */}
                {hasDraft(platform) && (
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    isLoading={savingThis}
                    startContent={!savingThis && <Save className="h-3 w-3" />}
                    onPress={() => void savePlatform(platform)}
                    className="h-7 min-w-0 px-2.5 text-[11px]"
                  >
                    Save
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform-specific credential fields
// ---------------------------------------------------------------------------

function PlatformFields({ platform, config, draftVal, draft }: {
  platform: Platform;
  config: ChannelsState;
  draftVal: (key: string) => string;
  draft: (key: string, value: string) => void;
}) {
  const row = (label: string, node: React.ReactNode) => (
    <div key={label} className="flex items-center gap-3">
      <span className="text-[11px] text-foreground/50 shrink-0 w-24">{label}</span>
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
              placeholder={config.telegram.hasToken ? config.telegram.tokenMasked : "1234567890:ABC…"}
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
            <Input size="sm" value={draftVal("guildId")} onValueChange={v => draft("guildId", v)}
              placeholder={config.discord.guildId ?? "optional"} />
          ))}
          {row("App ID", (
            <Input size="sm" value={draftVal("applicationId")} onValueChange={v => draft("applicationId", v)}
              placeholder={config.discord.applicationId ?? "optional"} />
          ))}
        </>
      );

    case "whatsapp":
      return (
        <>
          {row("Phone number ID", (
            <Input size="sm" value={draftVal("phoneNumberId")} onValueChange={v => draft("phoneNumberId", v)}
              placeholder={config.whatsapp.phoneNumberId ?? "1234567890"} />
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
            <Input size="sm" value={draftVal("phoneNumber")} onValueChange={v => draft("phoneNumber", v)}
              placeholder={config.signal.phoneNumber ?? "+1234567890"} />
          ))}
          {row("API URL", (
            <Input size="sm" value={draftVal("apiUrl")} onValueChange={v => draft("apiUrl", v)}
              placeholder={config.signal.apiUrl ?? "http://signal-cli:8080"} />
          ))}
        </>
      );

    case "matrix":
      return (
        <>
          {row("Homeserver URL", (
            <Input size="sm" value={draftVal("homeserverUrl")} onValueChange={v => draft("homeserverUrl", v)}
              placeholder={config.matrix.homeserverUrl ?? "https://matrix.example.com"} />
          ))}
          {row("Access token", (
            <MaskedInput
              value={draftVal("accessToken")}
              onChange={v => draft("accessToken", v)}
              placeholder={config.matrix.hasAccessToken ? config.matrix.accessTokenMasked : "syt_…"}
            />
          ))}
          {row("Room ID", (
            <Input size="sm" value={draftVal("roomId")} onValueChange={v => draft("roomId", v)}
              placeholder={config.matrix.roomId ?? "!room:example.com"} />
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
