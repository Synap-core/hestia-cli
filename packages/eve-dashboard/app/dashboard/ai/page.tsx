"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Card, CardBody, CardHeader, Button, Input, Select, SelectItem,
  Chip, Spinner, addToast, Divider, Switch,
} from "@heroui/react";
import { Plus, Trash2, RefreshCw, Save, Sparkles, Check, AlertCircle } from "lucide-react";

type ProviderId = "anthropic" | "openai" | "openrouter" | "ollama";

type ProviderEntry = {
  id: ProviderId;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked?: string;
  baseUrl?: string;
  defaultModel?: string;
};

type AiConfig = {
  mode: string | null;
  defaultProvider: ProviderId | null;
  fallbackProvider: ProviderId | null;
  providers: ProviderEntry[];
  validProviders: ProviderId[];
};

type ApplyResult = {
  ok: boolean;
  summary: string;
  results: Array<{
    id: string;
    outcome: "ok" | "skipped" | "failed";
    summary: string;
    detail?: string;
  }>;
};

const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  openrouter: "OpenRouter (multi-provider)",
  ollama: "Ollama (local)",
};

const DEFAULT_MODEL_PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-7",
  openai: "gpt-5",
  openrouter: "anthropic/claude-sonnet-4-7",
  ollama: "llama3.1:8b",
};

const KEY_PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  openrouter: "sk-or-...",
  ollama: "(no key needed)",
};

export default function AiProvidersPage() {
  const router = useRouter();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [editing, setEditing] = useState<Record<string, { apiKey?: string; defaultModel?: string }>>({});
  const [adding, setAdding] = useState<{
    id?: ProviderId;
    apiKey?: string;
    defaultModel?: string;
  } | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/ai", { credentials: "include" });
      if (res.status === 401) { router.push("/login"); return; }
      if (res.ok) setConfig(await res.json() as AiConfig);
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
      await fetch("/api/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ defaultProvider: id }),
      });
      addToast({ title: `${PROVIDER_LABELS[id]} set as default`, color: "success" });
      await fetchConfig();
    } finally { setSavingId(null); }
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
    return <div className="flex items-center justify-center h-64"><Spinner size="lg" color="primary" /></div>;
  }

  const hasAnyConfigured = (config?.providers ?? []).some(p => p.hasApiKey || p.id === "ollama");
  const availableToAdd = (config?.validProviders ?? []).filter(
    id => !config?.providers.find(p => p.id === id),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold">AI Providers</h1>
          </div>
          <p className="text-sm text-default-400 mt-1 max-w-xl">
            One source of truth for AI configuration. Synap IS routes every component (OpenClaw,
            Open WebUI, agents) through these providers — set keys here once, then click Apply.
          </p>
        </div>
        <Button
          color="primary"
          startContent={!applying ? <RefreshCw className="w-4 h-4" /> : undefined}
          isLoading={applying}
          isDisabled={!hasAnyConfigured}
          onPress={applyWiring}
        >
          {applying ? "Applying..." : "Apply to components"}
        </Button>
      </div>

      {!hasAnyConfigured && (
        <Card className="bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
          <CardBody className="flex-row items-center gap-3">
            <AlertCircle className="w-5 h-5 text-warning shrink-0" />
            <div className="text-sm">
              <p className="font-medium">No AI provider configured yet.</p>
              <p className="text-default-500 mt-0.5">Add one below — your installed components are sitting idle without an AI backend.</p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Configured providers */}
      <div className="grid gap-4">
        {(config?.providers ?? []).map(p => {
          const isEditing = !!editing[p.id];
          const editState = editing[p.id] ?? {};
          const isDefault = config?.defaultProvider === p.id;
          return (
            <Card key={p.id} className="bg-content1 border border-divider">
              <CardHeader className="flex justify-between items-start gap-3 pb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{PROVIDER_LABELS[p.id]}</span>
                    {isDefault && <Chip size="sm" color="primary" variant="flat" startContent={<Check className="w-3 h-3" />}>default</Chip>}
                    {!p.enabled && <Chip size="sm" color="default" variant="flat">disabled</Chip>}
                  </div>
                  <p className="text-xs text-default-400 mt-0.5">
                    {p.id === "ollama" ? "Local — no key required" : (p.hasApiKey ? `Key: ${p.apiKeyMasked}` : "No key set")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isDefault && (
                    <Button
                      size="sm"
                      variant="light"
                      onPress={() => void setDefault(p.id)}
                      isLoading={savingId === `default-${p.id}`}
                    >
                      Set default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    isIconOnly
                    onPress={() => void removeProvider(p.id)}
                    isDisabled={savingId === p.id}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardBody className="space-y-3 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {p.id !== "ollama" && (
                    <Input
                      label="API key"
                      labelPlacement="outside"
                      placeholder={isEditing ? KEY_PLACEHOLDERS[p.id] : (p.apiKeyMasked ?? "Click edit to set")}
                      value={editState.apiKey ?? ""}
                      onValueChange={v => setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], apiKey: v } }))}
                      type="password"
                      size="sm"
                      isDisabled={!isEditing}
                    />
                  )}
                  <Input
                    label="Default model"
                    labelPlacement="outside"
                    placeholder={DEFAULT_MODEL_PLACEHOLDERS[p.id]}
                    value={editState.defaultModel ?? p.defaultModel ?? ""}
                    onValueChange={v => setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], defaultModel: v } }))}
                    size="sm"
                    isDisabled={!isEditing}
                    description={p.id === "openrouter" ? "Form: provider/model (e.g. anthropic/claude-sonnet-4-7)" : undefined}
                  />
                </div>
                <div className="flex items-center justify-between">
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
                        onPress={() => setEditing(prev => { const n = { ...prev }; delete n[p.id]; return n; })}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        color="primary"
                        startContent={<Save className="w-3.5 h-3.5" />}
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
                      onPress={() => setEditing(prev => ({ ...prev, [p.id]: {} }))}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Add new provider */}
      {availableToAdd.length > 0 && (
        <>
          <Divider />
          {!adding ? (
            <Button
              variant="bordered"
              startContent={<Plus className="w-4 h-4" />}
              onPress={() => setAdding({})}
            >
              Add provider
            </Button>
          ) : (
            <Card className="bg-content1 border border-primary-200 dark:border-primary-800">
              <CardHeader className="pb-2">
                <span className="font-semibold">Add provider</span>
              </CardHeader>
              <CardBody className="space-y-3">
                <Select
                  label="Provider"
                  labelPlacement="outside"
                  placeholder="Pick a provider"
                  size="sm"
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
                    size="sm"
                  />
                )}
                {adding.id && (
                  <Input
                    label="Default model"
                    labelPlacement="outside"
                    placeholder={DEFAULT_MODEL_PLACEHOLDERS[adding.id]}
                    value={adding.defaultModel ?? ""}
                    onValueChange={v => setAdding(prev => ({ ...prev, defaultModel: v }))}
                    size="sm"
                    description={adding.id === "openrouter" ? "OpenRouter requires the form provider/model" : undefined}
                  />
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="light" onPress={() => setAdding(null)}>Cancel</Button>
                  <Button
                    size="sm"
                    color="primary"
                    isDisabled={!adding.id || (adding.id !== "ollama" && !adding.apiKey)}
                    isLoading={savingId === adding.id}
                    startContent={<Save className="w-3.5 h-3.5" />}
                    onPress={() => void saveProvider(adding.id!, {
                      apiKey: adding.apiKey,
                      defaultModel: adding.defaultModel,
                    })}
                  >
                    Add provider
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {/* Help text */}
      <Divider />
      <Card className="bg-content2 border-0">
        <CardBody className="text-sm text-default-500 space-y-1">
          <p><strong className="text-foreground">How this works:</strong> Eve stores provider keys once and propagates them to every installed component:</p>
          <ul className="list-disc list-inside ml-2 space-y-0.5">
            <li>Synap IS receives upstream provider keys (OpenAI/Anthropic/OpenRouter)</li>
            <li>OpenClaw is wired to use Synap IS as its OpenAI-compat backend</li>
            <li>Open WebUI is wired the same way</li>
          </ul>
          <p className="mt-2">After adding or changing a key, click <strong className="text-foreground">Apply to components</strong> — this restarts the affected containers.</p>
        </CardBody>
      </Card>
    </div>
  );
}
