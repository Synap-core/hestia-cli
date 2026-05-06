"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Button, Input, Select, SelectItem, Spinner, addToast, Switch, Chip,
} from "@heroui/react";
import {
  Plus, Trash2, RefreshCw, Save, Check, AlertCircle, Plug, MessageSquare, ExternalLink,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProviderId = "anthropic" | "openai" | "openrouter" | "ollama";

interface ProviderEntry {
  id: ProviderId;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked?: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface AiConfig {
  mode: string | null;
  defaultProvider: ProviderId | null;
  fallbackProvider: ProviderId | null;
  /** Per-service override: componentId → providerId. Missing = use default. */
  serviceProviders: Partial<Record<string, ProviderId>>;
  /** Per-service model override: componentId → model string. */
  serviceModels: Partial<Record<string, string>>;
  providers: ProviderEntry[];
  validProviders: ProviderId[];
  /** Component ids that consume the central AI config. Server-driven. */
  aiConsumers: string[];
}

interface MessagingConfig {
  enabled: boolean;
  platform: string | null;
  hasToken: boolean;
  tokenMasked?: string;
}

type MessagingPlatform = "telegram" | "discord" | "signal" | "matrix";

interface ApplyResult {
  ok: boolean;
  summary: string;
  results: Array<{
    id: string;
    outcome: "ok" | "skipped" | "failed";
    summary: string;
    detail?: string;
  }>;
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic:  "Anthropic",
  openai:     "OpenAI",
  openrouter: "OpenRouter",
  ollama:     "Ollama (local)",
};

const PROVIDER_TAGLINE: Record<ProviderId, string> = {
  anthropic:  "Claude family of models.",
  openai:     "GPT family of models.",
  openrouter: "Hundreds of models behind one key.",
  ollama:     "Local models, no key required.",
};

const DEFAULT_MODEL_PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic:  "claude-sonnet-4-7",
  openai:     "gpt-5",
  openrouter: "anthropic/claude-sonnet-4-7",
  ollama:     "llama3.1:8b",
};

const KEY_PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic:  "sk-ant-...",
  openai:     "sk-...",
  openrouter: "sk-or-...",
  ollama:     "(no key needed)",
};

// ---------------------------------------------------------------------------
// Layout primitives — same as dashboard home, kept local for now
// ---------------------------------------------------------------------------

function Surface({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-divider bg-content1 ${className}`}>{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface ComponentSummary {
  id: string;
  label: string;
  installed: boolean;
}

export default function AiProvidersPage() {
  const router = useRouter();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [consumers, setConsumers] = useState<ComponentSummary[] | null>(null);
  const [messaging, setMessaging] = useState<MessagingConfig | null>(null);
  const [editingMessaging, setEditingMessaging] = useState<{ platform?: string; botToken?: string } | null>(null);
  const [savingMessaging, setSavingMessaging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [editing, setEditing] = useState<Record<string, { apiKey?: string; defaultModel?: string }>>({});
  const [adding, setAdding] = useState<{ id?: ProviderId; apiKey?: string; defaultModel?: string } | null>(null);
  const [editingServiceModels, setEditingServiceModels] = useState<Record<string, string>>({});

  const fetchConfig = useCallback(async () => {
    try {
      const [aiRes, compRes, msgRes] = await Promise.all([
        fetch("/api/ai", { credentials: "include" }),
        fetch("/api/components", { credentials: "include" }),
        fetch("/api/arms/messaging", { credentials: "include" }),
      ]);
      if (aiRes.status === 401) { router.push("/login"); return; }
      let aiConsumers: string[] = [];
      if (aiRes.ok) {
        const cfg = await aiRes.json() as AiConfig;
        setConfig(cfg);
        aiConsumers = cfg.aiConsumers ?? [];
      }
      if (compRes.ok) {
        const data = await compRes.json() as { components: Array<{ id: string; label: string; installed: boolean }> };
        const consumerSet = new Set(aiConsumers);
        setConsumers(
          data.components
            .filter(c => consumerSet.has(c.id))
            .map(c => ({ id: c.id, label: c.label, installed: c.installed })),
        );
      }
      if (msgRes.ok) {
        setMessaging(await msgRes.json() as MessagingConfig);
      }
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void fetchConfig(); }, [fetchConfig]);

  async function saveProvider(id: ProviderId, body: Record<string, unknown>) {
    setSavingId(id);
    try {
      const res = await fetch("/api/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, ...body }),
      });
      if (res.ok) {
        addToast({ title: `${PROVIDER_LABELS[id]} saved`, color: "success" });
        setEditing(prev => { const n = { ...prev }; delete n[id]; return n; });
        setAdding(null);
        await fetchConfig();
      } else {
        const err = await res.json() as { error?: string };
        addToast({ title: err.error ?? "Save failed", color: "danger" });
      }
    } catch {
      addToast({ title: "Save failed", color: "danger" });
    } finally { setSavingId(null); }
  }

  async function removeProvider(id: ProviderId) {
    if (!confirm(`Remove ${PROVIDER_LABELS[id]}? This won't auto-revert installed components.`)) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/ai/providers?id=${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        addToast({ title: "Provider removed", color: "success" });
        await fetchConfig();
      }
    } finally { setSavingId(null); }
  }

  async function setDefault(id: ProviderId) {
    setSavingId(`default-${id}`);
    try {
      const res = await fetch("/api/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ defaultProvider: id }),
      });
      const data = await res.json().catch(() => ({})) as { applied?: Array<{ outcome: string }> };
      const okCount = (data.applied ?? []).filter(r => r.outcome === "ok").length;
      addToast({
        title: okCount > 0
          ? `${PROVIDER_LABELS[id]} set · ${okCount} service(s) re-wired`
          : `${PROVIDER_LABELS[id]} set as default`,
        color: "success",
      });
      await fetchConfig();
    } finally { setSavingId(null); }
  }

  async function setServiceProvider(componentId: string, providerId: ProviderId | null) {
    setSavingId(`svc-${componentId}`);
    try {
      const res = await fetch("/api/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          serviceProviders: { [componentId]: providerId },
        }),
      });
      const data = await res.json().catch(() => ({})) as { applied?: Array<{ id: string; outcome: string }> };
      const wired = (data.applied ?? []).find(r => r.id === componentId);
      addToast({
        title: providerId === null
          ? `${componentId} reverted to default${wired?.outcome === "ok" ? " · re-wired" : ""}`
          : `${componentId} now routes via ${PROVIDER_LABELS[providerId]}${wired?.outcome === "ok" ? " · re-wired" : ""}`,
        color: "success",
      });
      await fetchConfig();
    } finally { setSavingId(null); }
  }

  async function setServiceModel(componentId: string, model: string | null) {
    setSavingId(`model-${componentId}`);
    try {
      const res = await fetch("/api/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ serviceModels: { [componentId]: model } }),
      });
      const data = await res.json().catch(() => ({})) as { applied?: Array<{ id: string; outcome: string }> };
      const wired = (data.applied ?? []).find(r => r.id === componentId);
      addToast({
        title: model === null
          ? `${componentId} using provider default model${wired?.outcome === "ok" ? " · re-wired" : ""}`
          : `${componentId} model set to ${model}${wired?.outcome === "ok" ? " · re-wired" : ""}`,
        color: "success",
      });
      setEditingServiceModels(prev => { const n = { ...prev }; delete n[componentId]; return n; });
      await fetchConfig();
    } catch {
      addToast({ title: "Failed to save model override", color: "danger" });
    } finally { setSavingId(null); }
  }

  async function saveMessaging() {
    if (!editingMessaging) return;
    setSavingMessaging(true);
    try {
      const res = await fetch("/api/arms/messaging", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          enabled: true,
          platform: editingMessaging.platform || null,
          botToken: editingMessaging.botToken || null,
        }),
      });
      if (res.ok) {
        addToast({ title: "Messaging config saved · OpenClaw restarted", color: "success" });
        setEditingMessaging(null);
        await fetchConfig();
      } else {
        const err = await res.json() as { error?: string };
        addToast({ title: err.error ?? "Save failed", color: "danger" });
      }
    } catch {
      addToast({ title: "Save failed", color: "danger" });
    } finally { setSavingMessaging(false); }
  }

  async function disableMessaging() {
    setSavingMessaging(true);
    try {
      await fetch("/api/arms/messaging", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: false }),
      });
      addToast({ title: "Messaging disabled", color: "success" });
      await fetchConfig();
    } catch {
      addToast({ title: "Failed", color: "danger" });
    } finally { setSavingMessaging(false); }
  }

  async function applyWiring() {
    setApplying(true);
    try {
      const res = await fetch("/api/ai/apply", { method: "POST", credentials: "include" });
      const data = await res.json() as ApplyResult;
      if (data.ok) {
        addToast({ title: `Applied: ${data.summary}`, color: "success" });
      } else {
        addToast({ title: `Partial: ${data.summary}`, color: "warning" });
      }
    } catch {
      addToast({ title: "Apply failed", color: "danger" });
    } finally { setApplying(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" color="primary" />
      </div>
    );
  }

  const hasAnyConfigured = (config?.providers ?? []).some(p => p.hasApiKey || p.id === "ollama");
  const availableToAdd = (config?.validProviders ?? []).filter(
    id => !config?.providers.find(p => p.id === id),
  );

  return (
    <div className="space-y-10">
      {/* -----------------------------------------------------------------
       * Header
       * -------------------------------------------------------------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-default-500">Configuration</p>
          <h1 className="mt-1 font-heading text-3xl font-medium tracking-tightest text-foreground">
            AI Providers
          </h1>
          <p className="mt-1 max-w-2xl text-default-500">
            One source of truth for the brain behind your stack. Set keys here once;
            Synap IS, OpenClaw, and Open WebUI all read from this single config.
          </p>
        </div>
        <Button
          color="primary"
          radius="md"
          startContent={!applying ? <RefreshCw className="h-4 w-4" /> : undefined}
          isLoading={applying}
          isDisabled={!hasAnyConfigured}
          onPress={applyWiring}
        >
          {applying ? "Applying…" : "Apply to components"}
        </Button>
      </header>

      {/* -----------------------------------------------------------------
       * Empty state
       * -------------------------------------------------------------- */}
      {!hasAnyConfigured && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-foreground">No AI provider configured yet.</p>
            <p className="mt-0.5 text-default-500">
              Your installed components are sitting idle. Add a provider below.
            </p>
          </div>
        </div>
      )}

      {/* -----------------------------------------------------------------
       * Configured providers
       * -------------------------------------------------------------- */}
      {(config?.providers.length ?? 0) > 0 && (
        <div className="space-y-3">
          {(config?.providers ?? []).map(p => {
            const isEditing = !!editing[p.id];
            const editState = editing[p.id] ?? {};
            const isDefault = config?.defaultProvider === p.id;
            const ok = p.id === "ollama" || p.hasApiKey;
            return (
              <Surface key={p.id} className="p-5">
                {/* Row header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span
                      className={
                        "mt-1 inline-block h-2 w-2 rounded-full " +
                        (ok ? "bg-primary" : "bg-default-300")
                      }
                      aria-hidden
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{PROVIDER_LABELS[p.id]}</span>
                        {isDefault && (
                          <Chip
                            size="sm"
                            color="primary"
                            variant="flat"
                            radius="sm"
                            startContent={<Check className="h-3 w-3" />}
                            classNames={{ content: "px-1 text-[10px] font-medium uppercase tracking-wider" }}
                          >
                            default
                          </Chip>
                        )}
                        {!p.enabled && (
                          <Chip
                            size="sm"
                            variant="flat"
                            radius="sm"
                            classNames={{ content: "px-1 text-[10px] font-medium uppercase tracking-wider text-default-500" }}
                          >
                            disabled
                          </Chip>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-default-500">{PROVIDER_TAGLINE[p.id]}</p>
                      {p.id !== "ollama" && (
                        <p className="mt-1 font-mono text-[11px] text-default-400">
                          {p.hasApiKey ? p.apiKeyMasked : "no key set"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!isDefault && ok && (
                      <Button
                        size="sm"
                        variant="light"
                        radius="md"
                        onPress={() => void setDefault(p.id)}
                        isLoading={savingId === `default-${p.id}`}
                        className="text-default-600 hover:text-foreground"
                      >
                        Set default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="light"
                      radius="md"
                      isIconOnly
                      onPress={() => void removeProvider(p.id)}
                      isDisabled={savingId === p.id}
                      className="text-default-400 hover:text-danger"
                      aria-label={`Remove ${PROVIDER_LABELS[p.id]}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Fields — HeroUI Input with label outside (no wrapper height
                    override; let HeroUI size things so the label slot is
                    reserved correctly above the input). */}
                <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {p.id !== "ollama" && (
                    <Input
                      label="API key"
                      labelPlacement="outside"
                      placeholder={isEditing ? KEY_PLACEHOLDERS[p.id] : (p.apiKeyMasked ?? "Click edit to set")}
                      value={editState.apiKey ?? ""}
                      onValueChange={v =>
                        setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], apiKey: v } }))
                      }
                      type="password"
                      variant="bordered"
                      isDisabled={!isEditing}
                      classNames={{ input: "font-mono text-sm" }}
                    />
                  )}
                  <Input
                    label="Default model"
                    labelPlacement="outside"
                    placeholder={DEFAULT_MODEL_PLACEHOLDERS[p.id]}
                    value={editState.defaultModel ?? p.defaultModel ?? ""}
                    onValueChange={v =>
                      setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], defaultModel: v } }))
                    }
                    variant="bordered"
                    isDisabled={!isEditing}
                    description={
                      p.id === "openrouter"
                        ? "Form: provider/model — e.g. anthropic/claude-sonnet-4-7"
                        : undefined
                    }
                    classNames={{ input: "font-mono text-sm" }}
                  />
                </div>

                {/* Footer */}
                <div className="mt-5 flex items-center justify-between border-t border-divider pt-4">
                  <Switch
                    size="sm"
                    isSelected={p.enabled}
                    onValueChange={v => void saveProvider(p.id, { enabled: v })}
                  >
                    <span className="text-xs text-default-500">Enabled</span>
                  </Switch>
                  {isEditing ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="light"
                        radius="md"
                        onPress={() =>
                          setEditing(prev => { const n = { ...prev }; delete n[p.id]; return n; })
                        }
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        color="primary"
                        radius="md"
                        startContent={<Save className="h-3.5 w-3.5" />}
                        isLoading={savingId === p.id}
                        onPress={() => void saveProvider(p.id, {
                          ...(editState.apiKey ? { apiKey: editState.apiKey } : {}),
                          ...(editState.defaultModel ? { defaultModel: editState.defaultModel } : {}),
                        })}
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="bordered"
                      radius="md"
                      onPress={() => setEditing(prev => ({ ...prev, [p.id]: {} }))}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </Surface>
            );
          })}
        </div>
      )}

      {/* -----------------------------------------------------------------
       * Add provider
       * -------------------------------------------------------------- */}
      {availableToAdd.length > 0 && (
        <div>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding({})}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-divider bg-content1/40 px-4 py-4 text-sm text-default-500 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              <Plus className="h-4 w-4" />
              Add a provider
            </button>
          ) : (
            <Surface className="p-5">
              <h3 className="font-medium text-foreground">Add a provider</h3>
              <p className="mt-0.5 text-xs text-default-500">
                Configure the key, set a default model, then save. You can apply it to components afterwards.
              </p>
              <div className="mt-6 space-y-4">
                <Select
                  label="Provider"
                  labelPlacement="outside"
                  placeholder="Pick a provider"
                  variant="bordered"
                  selectedKeys={adding.id ? [adding.id] : []}
                  onSelectionChange={keys => {
                    const id = Array.from(keys)[0] as ProviderId | undefined;
                    setAdding({ id, defaultModel: id ? DEFAULT_MODEL_PLACEHOLDERS[id] : undefined });
                  }}
                >
                  {availableToAdd.map(id => (
                    <SelectItem key={id}>{PROVIDER_LABELS[id]}</SelectItem>
                  ))}
                </Select>
                {adding.id && adding.id !== "ollama" && (
                  <Input
                    label="API key"
                    labelPlacement="outside"
                    placeholder={KEY_PLACEHOLDERS[adding.id]}
                    value={adding.apiKey ?? ""}
                    onValueChange={v => setAdding(prev => ({ ...prev, apiKey: v }))}
                    type="password"
                    variant="bordered"
                    classNames={{ input: "font-mono text-sm" }}
                  />
                )}
                {adding.id && (
                  <Input
                    label="Default model"
                    labelPlacement="outside"
                    placeholder={DEFAULT_MODEL_PLACEHOLDERS[adding.id]}
                    value={adding.defaultModel ?? ""}
                    onValueChange={v => setAdding(prev => ({ ...prev, defaultModel: v }))}
                    variant="bordered"
                    description={
                      adding.id === "openrouter"
                        ? "OpenRouter requires the form provider/model."
                        : undefined
                    }
                    classNames={{ input: "font-mono text-sm" }}
                  />
                )}
              </div>
              <div className="mt-5 flex justify-end gap-2 border-t border-divider pt-4">
                <Button size="sm" variant="light" radius="md" onPress={() => setAdding(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  color="primary"
                  radius="md"
                  isDisabled={!adding.id || (adding.id !== "ollama" && !adding.apiKey)}
                  isLoading={!!savingId}
                  startContent={<Save className="h-3.5 w-3.5" />}
                  onPress={() => void saveProvider(adding.id!, {
                    apiKey: adding.apiKey,
                    defaultModel: adding.defaultModel,
                  })}
                >
                  Add provider
                </Button>
              </div>
            </Surface>
          )}
        </div>
      )}

      {/* -----------------------------------------------------------------
       * Per-service routing — pick a provider per service or inherit the
       * global default. Saving auto-applies the wiring (writes config +
       * restarts the affected container).
       * -------------------------------------------------------------- */}
      {consumers && consumers.length > 0 && (
        <Surface className="p-5">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-default-500" />
            <h3 className="font-medium text-foreground">Per-service routing</h3>
          </div>
          <p className="mt-1 text-xs text-default-500">
            By default each service uses your global provider and model. Override either per service — saves and re-wires automatically.
          </p>
          <ul className="mt-4 space-y-2">
            {consumers.map(c => {
              const override = config?.serviceProviders?.[c.id];
              const modelOverride = config?.serviceModels?.[c.id];
              const effective = override ?? config?.defaultProvider ?? null;
              const usable = (config?.providers ?? []).filter(
                p => p.id === "ollama" || p.hasApiKey,
              );
              const editingModel = editingServiceModels[c.id] ?? modelOverride ?? "";
              const isModelDirty = editingServiceModels[c.id] !== undefined && editingServiceModels[c.id] !== (modelOverride ?? "");
              return (
                <li
                  key={c.id}
                  className="flex flex-col gap-2 rounded-lg border border-divider bg-content1 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{c.label}</span>
                        {!c.installed && (
                          <Chip size="sm" variant="flat" radius="sm">not installed</Chip>
                        )}
                        {c.installed && (override || modelOverride) && (
                          <Chip size="sm" color="primary" variant="flat" radius="sm">override</Chip>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-default-500">
                        {effective
                          ? `Routes via ${PROVIDER_LABELS[effective as ProviderId] ?? effective}`
                          : "No provider — pick one above first"}
                        {modelOverride && ` · model: ${modelOverride}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Select
                        size="sm"
                        variant="bordered"
                        className="min-w-[180px]"
                        aria-label={`Provider for ${c.label}`}
                        isDisabled={!c.installed || !!savingId || usable.length === 0}
                        selectedKeys={override ? new Set([override]) : new Set(["__default__"])}
                        onSelectionChange={(keys) => {
                          const sel = Array.from(keys)[0] as string | undefined;
                          const next = sel === "__default__" || !sel
                            ? null
                            : sel as ProviderId;
                          if (next === (override ?? null)) return;
                          void setServiceProvider(c.id, next);
                        }}
                      >
                        {[
                          <SelectItem key="__default__">Use global default</SelectItem>,
                          ...usable.map(p => (
                            <SelectItem key={p.id}>{PROVIDER_LABELS[p.id]}</SelectItem>
                          )),
                        ]}
                      </Select>
                    </div>
                  </div>
                  {/* Per-service model override */}
                  <div className="flex items-center gap-2">
                    <Input
                      size="sm"
                      variant="bordered"
                      placeholder="Model override (e.g. llama3.1:8b, claude-sonnet-4-7) — leave blank for provider default"
                      className="flex-1 text-xs"
                      value={editingModel}
                      isDisabled={!c.installed || !!savingId}
                      onValueChange={v => setEditingServiceModels(prev => ({ ...prev, [c.id]: v }))}
                    />
                    {isModelDirty && (
                      <Button
                        size="sm"
                        color="primary"
                        variant="flat"
                        isLoading={savingId === `model-${c.id}`}
                        onPress={() => {
                          const val = editingServiceModels[c.id]?.trim() || null;
                          void setServiceModel(c.id, val);
                        }}
                      >
                        Save
                      </Button>
                    )}
                    {modelOverride && !isModelDirty && (
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => void setServiceModel(c.id, null)}
                        isDisabled={!!savingId}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Surface>
      )}

      {/* -----------------------------------------------------------------
       * Help — quiet, last
       * -------------------------------------------------------------- */}
      <section className="rounded-xl border border-divider bg-content1/60 p-5 text-sm text-default-500">
        <p className="font-medium text-foreground">How this works</p>
        <p className="mt-2">
          Eve stores provider keys once and propagates them to every installed component:
        </p>
        <ul className="mt-2 space-y-1">
          <li className="flex gap-2"><span className="text-default-400">→</span> Synap IS receives upstream provider keys (Anthropic / OpenAI / OpenRouter).</li>
          <li className="flex gap-2"><span className="text-default-400">→</span> OpenClaw is wired to use Synap IS as its OpenAI-compat backend.</li>
          <li className="flex gap-2"><span className="text-default-400">→</span> Open WebUI and Hermes are wired the same way.</li>
          <li className="flex gap-2"><span className="text-default-400">→</span> Each service can override the provider and model via the per-service routing panel above.</li>
        </ul>
        <p className="mt-3">
          Most changes auto-apply on save. Use{" "}
          <span className="font-medium text-foreground">Apply to components</span> when you want to manually re-push the current config (e.g. after restarting a container).
        </p>
        <a
          href="/settings/channels"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Configure messaging channels (Telegram, Discord, etc.)
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>
      </section>
    </div>
  );
}
