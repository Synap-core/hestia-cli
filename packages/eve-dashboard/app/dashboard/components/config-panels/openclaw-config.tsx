"use client";

/**
 * OpenClaw configuration panel — three sub-sections:
 *  - MCP servers     → list + install presets + remove
 *  - Messaging       → telegram bot token (most useful surface)
 *  - Voice           → twilio / signal / selfhosted (lighter use)
 *
 * After any change a "Restart OpenClaw" affordance shows up — config is
 * read at OpenClaw boot, so changes don't take effect until restart.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Input, Button, Spinner, Chip, Select, SelectItem, Switch, addToast,
} from "@heroui/react";
import {
  Plug, Trash2, MessageSquare, Phone, Plus, RotateCcw,
} from "lucide-react";

interface McpServer { name: string; command: string; args: string[]; }
interface McpPreset { id: string; command: string; args: string[]; description: string; }

interface VoiceConfig {
  enabled: boolean;
  provider?: "twilio" | "signal" | "selfhosted";
  phoneNumber?: string;
  sipUri?: string;
}

interface MessagingConfig {
  enabled: boolean;
  platform?: "telegram" | "signal" | "matrix";
  hasToken: boolean;
}

export function OpenclawConfigPanel() {
  return (
    <div className="space-y-6">
      <McpSection />
      <MessagingSection />
      <VoiceSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

function McpSection() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/components/openclaw/mcp", { credentials: "include" });
    if (res.ok) {
      const data = await res.json() as { servers: McpServer[]; presets: McpPreset[] };
      setServers(data.servers);
      setPresets(data.presets);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const onInstall = useCallback(async (preset: string) => {
    setInstalling(preset);
    try {
      const res = await fetch("/api/components/openclaw/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ preset }),
      });
      if (res.ok) {
        addToast({ title: `MCP server "${preset}" installed`, color: "success" });
        setRestartNeeded(true);
        void fetchData();
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        addToast({ title: err.error ?? "Couldn't install MCP server", color: "danger" });
      }
    } finally { setInstalling(null); }
  }, [fetchData]);

  const onRemove = useCallback(async (name: string) => {
    setRemoving(name);
    try {
      const res = await fetch(`/api/components/openclaw/mcp/${encodeURIComponent(name)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        addToast({ title: `MCP server "${name}" removed`, color: "success" });
        setRestartNeeded(true);
        void fetchData();
      }
    } finally { setRemoving(null); }
  }, [fetchData]);

  const onRestart = useCallback(async () => {
    const res = await fetch("/api/components/openclaw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "restart" }),
    });
    if (res.ok) {
      addToast({ title: "OpenClaw restarted", color: "success" });
      setRestartNeeded(false);
    }
  }, []);

  const installedSet = new Set(servers?.map(s => s.name) ?? []);

  return (
    <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <Plug className="h-3.5 w-3.5" />
          <span>MCP servers</span>
        </div>
        {restartNeeded && (
          <Button
            size="sm"
            color="primary"
            radius="md"
            startContent={<RotateCcw className="h-3.5 w-3.5" />}
            onPress={() => void onRestart()}
          >
            Restart OpenClaw
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-3"><Spinner size="sm" /></div>
      ) : (
        <>
          {/* Installed */}
          {servers && servers.length > 0 && (
            <div className="overflow-hidden rounded-md border border-divider bg-content1">
              {servers.map((s, i) => (
                <div
                  key={s.name}
                  className={
                    "flex items-center gap-3 px-3 py-2 " +
                    (i === 0 ? "" : "border-t border-divider")
                  }
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                    <p className="font-mono text-[11px] text-default-500 truncate">
                      {s.command} {s.args.join(" ")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    radius="md"
                    isLoading={removing === s.name}
                    isDisabled={removing !== null}
                    startContent={<Trash2 className="h-3.5 w-3.5" />}
                    onPress={() => void onRemove(s.name)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Available presets */}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-default-400 mb-2">
              Available presets
            </p>
            <div className="grid grid-cols-1 gap-2">
              {presets.map(p => {
                const installed = installedSet.has(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-start gap-3 rounded-md border border-divider bg-content1 px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{p.id}</p>
                        {installed && <Chip size="sm" variant="flat" color="success" radius="sm">installed</Chip>}
                      </div>
                      <p className="text-xs text-default-500">{p.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="bordered"
                      radius="md"
                      isDisabled={installed || installing !== null}
                      isLoading={installing === p.id}
                      startContent={!installing ? <Plus className="h-3.5 w-3.5" /> : undefined}
                      onPress={() => void onInstall(p.id)}
                    >
                      {installed ? "Installed" : "Install"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function MessagingSection() {
  const [cfg, setCfg] = useState<MessagingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState("");

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
          // Only send botToken if user typed one — otherwise preserve.
          botToken: token.length > 0 ? token : undefined,
        }),
      });
      if (res.ok) {
        const next = await res.json() as MessagingConfig;
        setCfg(next);
        setToken("");
        addToast({ title: "Messaging saved · restart OpenClaw to apply", color: "success" });
      }
    } finally { setSaving(false); }
  }, [cfg, token]);

  if (loading || !cfg) {
    return <div className="rounded-lg border border-divider bg-content2/40 p-4"><Spinner size="sm" /></div>;
  }

  return (
    <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-6">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
        <MessageSquare className="h-3.5 w-3.5" />
        <span>Messaging</span>
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
          const v = Array.from(keys)[0] as MessagingConfig["platform"];
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
        label={cfg.hasToken ? "Bot token (leave blank to keep current)" : "Bot token"}
        labelPlacement="outside"
        type="password"
        placeholder={cfg.hasToken ? "•••••••••• stored" : "Paste bot token"}
        value={token}
        onValueChange={setToken}
      />
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
// Voice
// ---------------------------------------------------------------------------

function VoiceSection() {
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
        addToast({ title: "Voice saved · restart OpenClaw to apply", color: "success" });
      }
    } finally { setSaving(false); }
  }, [cfg]);

  if (loading || !cfg) {
    return <div className="rounded-lg border border-divider bg-content2/40 p-4"><Spinner size="sm" /></div>;
  }

  return (
    <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-6">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
        <Phone className="h-3.5 w-3.5" />
        <span>Voice</span>
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
          const v = Array.from(keys)[0] as VoiceConfig["provider"];
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
