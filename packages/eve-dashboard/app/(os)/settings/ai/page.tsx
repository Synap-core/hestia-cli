"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Button, Input, Select, SelectItem, Spinner, addToast, Switch, Chip,
} from "@heroui/react";
import {
  Plus, Trash2, RefreshCw, Save, Check, AlertCircle, Plug, MessageSquare, ExternalLink,
  Beaker, CheckCircle2, XCircle, Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderEntry {
  id: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked?: string;
  baseUrl?: string;
  defaultModel?: string;
  isCustom?: boolean;
  name?: string;
}

interface AiConfig {
  mode: string | null;
  defaultProvider: string | null;
  fallbackProvider: string | null;
  /** Per-service override: componentId → providerId. Missing = use default. */
  serviceProviders: Record<string, string | null>;
  /** Per-service model override: componentId → model string. */
  serviceModels: Record<string, string | null>;
  /** Per-component wiring status: { [id]: { lastApplied, outcome } }. */
  wiringStatus: Record<string, { lastApplied: string; outcome: string }>;
  /** Unified list: all providers (built-in + custom). */
  providers: ProviderEntry[];
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

const PROVIDER_LABELS: Record<string, string> = {
  anthropic:  "Anthropic",
  openai:     "OpenAI",
  openrouter: "OpenRouter",
  ollama:     "Ollama (local)",
};

const COMPONENT_LABELS: Record<string, string> = {
  "synap-is":   "Synap IS",
  "openclaw":   "OpenClaw",
  "open-webui": "Open WebUI",
  "hermes":     "Hermes",
};

function getComponentLabel(id: string): string {
  return COMPONENT_LABELS[id] ?? id;
}

function formatOutcome(outcome: string): string {
  switch (outcome) {
    case "ok":          return "OK";
    case "failed":      return "failed";
    case "skipped":     return "skipped";
    default:            return outcome;
  }
}

function getProviderLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id.split("custom-")[1] ?? id;
}

const PROVIDER_TAGLINE: Record<string, string> = {
  anthropic:  "Claude family of models.",
  openai:     "GPT family of models.",
  openrouter: "Hundreds of models behind one key.",
  ollama:     "Local models, no key required.",
};

const BUILT_IN_DEFS = [
  { id: "anthropic",  name: "Anthropic",     tagline: "Claude models",         defaultBaseUrl: "" },
  { id: "openai",     name: "OpenAI",         tagline: "GPT models",            defaultBaseUrl: "" },
  { id: "openrouter", name: "OpenRouter",     tagline: "500+ models, one key",  defaultBaseUrl: "" },
  { id: "ollama",     name: "Ollama (local)", tagline: "Local, no key needed",  defaultBaseUrl: "http://localhost:11434" },
] as const;

const DEFAULT_MODEL_PLACEHOLDERS: Record<string, string> = {
  anthropic:  "claude-sonnet-4-7",
  openai:     "gpt-5",
  openrouter: "anthropic/claude-sonnet-4-7",
  ollama:     "llama3.1:8b",
};

const KEY_PLACEHOLDERS: Record<string, string> = {
  anthropic:  "sk-ant-...",
  openai:     "sk-...",
  openrouter: "sk-or-...",
  ollama:     "(no key needed)",
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Layout primitives
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
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; latency: number; modelCount: number; models: string[]; error?: string } | undefined>>({});
  const [applying, setApplying] = useState(false);
  const [editing, setEditing] = useState<Record<string, { apiKey?: string; defaultModel?: string; baseUrl?: string; name?: string }>>({});
  const [adding, setAdding] = useState<{
    id?: string;
    isCustom?: boolean;
    apiKey?: string;
    defaultModel?: string;
    name?: string;
    baseUrl?: string;
  } | null>(null);
  const [editingServiceModels, setEditingServiceModels] = useState<Record<string, string>>({});
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [detectingOllama, setDetectingOllama] = useState(false);
  const [cardOllamaModels, setCardOllamaModels] = useState<Record<string, string[]>>({});
  const [cardDetectingOllama, setCardDetectingOllama] = useState<string | null>(null);
  const [pendingDefault, setPendingDefault] = useState<string | null>(null);

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

  async function saveProvider(id: string, body: Record<string, unknown>) {
    setSavingId(id);
    try {
      const res = await fetch("/api/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, ...body }),
      });
      if (res.ok) {
        addToast({ title: `${getProviderLabel(id)} saved`, color: "success" });
        setEditing(prev => { const n = { ...prev }; delete n[id]; return n; });
        setAdding(null);
        await fetchConfig();
      } else {
        const err = await res.json() as { error?: string };
        addToast({ title: err.error ?? "Save failed", color: "danger" });
        setAdding(null);
      }
    } catch {
      addToast({ title: "Save failed", color: "danger" });
      setAdding(null);
    } finally { setSavingId(null); }
  }

  async function removeProvider(id: string) {
    if (!confirm(`Remove ${getProviderLabel(id)}? This won't auto-revert installed components.`)) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/ai/providers?id=${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        addToast({ title: "Provider removed", color: "success" });
        await fetchConfig();
      }
    } finally { setSavingId(null); }
  }

  async function testProvider(id: string) {
    setTestingId(id);
    // Don't blank the old result — keep it visible with a loading overlay while retesting.
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ providerId: id }),
      });
      const data = await res.json() as { ok?: boolean; latency?: number; modelCount?: number; models?: string[]; error?: string };
      setTestResults(prev => ({
        ...prev,
        [id]: {
          ok: data.ok ?? false,
          latency: data.latency ?? 0,
          modelCount: data.modelCount ?? 0,
          models: data.models ?? [],
          error: data.error,
        },
      }));
      if (res.ok && data.ok) {
        addToast({ title: `${getProviderLabel(id)}: OK · ${data.modelCount} models`, color: "success" });
      } else {
        addToast({ title: `${getProviderLabel(id)}: ${data.error ?? "Test failed"}`, color: "danger" });
      }
    } catch {
      addToast({ title: `${getProviderLabel(id)}: Network error`, color: "danger" });
    } finally { setTestingId(null); }
  }

  async function detectOllamaModelsForCard(providerId: string, baseUrl: string) {
    setCardDetectingOllama(providerId);
    try {
      const url = baseUrl || "http://localhost:11434";
      const res = await fetch(`/api/ai/ollama-models?url=${encodeURIComponent(url)}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { models: string[] };
        setCardOllamaModels(prev => ({ ...prev, [providerId]: data.models }));
        if (data.models.length === 0) addToast({ title: "Ollama reachable — no models installed yet", color: "warning" });
      } else {
        addToast({ title: "Could not reach Ollama — check the URL in Edit", color: "danger" });
      }
    } catch {
      addToast({ title: "Ollama detection failed", color: "danger" });
    } finally {
      setCardDetectingOllama(null);
    }
  }

  async function setDefault(id: string) {
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
          ? `${getProviderLabel(id)} set · ${okCount} service(s) re-wired`
          : `${getProviderLabel(id)} set as default`,
        color: "success",
      });
      await fetchConfig();
    } finally { setSavingId(null); }
  }

  async function setServiceProvider(componentId: string, providerId: string | null) {
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
          : `${componentId} now routes via ${getProviderLabel(providerId)}${wired?.outcome === "ok" ? " · re-wired" : ""}`,
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
      const lines = data.results.map(r =>
        `  ${getComponentLabel(r.id)}: ${formatOutcome(r.outcome)}`,
      ).join("\n");
      const color = data.ok ? "success" : "warning";
      if (lines) {
        addToast({
          title: data.ok ? "Apply complete" : "Apply completed with errors",
          description: lines,
          color,
        });
      } else {
        addToast({ title: "No components to apply", color: "success" });
      }
    } catch {
      addToast({ title: "Apply failed", color: "danger" });
    } finally { setApplying(false); }
  }

  async function detectOllamaModels() {
    setDetectingOllama(true);
    try {
      const url = (adding?.baseUrl?.trim() || "http://localhost:11434");
      const res = await fetch(`/api/ai/ollama-models?url=${encodeURIComponent(url)}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { models: string[] };
        setOllamaModels(data.models);
        if (data.models.length > 0 && !adding?.defaultModel) {
          setAdding(prev => prev ? { ...prev, defaultModel: data.models[0] } : prev);
        }
        if (data.models.length === 0) {
          addToast({ title: "Ollama reachable but no models installed", color: "warning" });
        }
      } else {
        addToast({ title: "Could not reach Ollama — check the URL", color: "danger" });
      }
    } catch {
      addToast({ title: "Ollama detection failed", color: "danger" });
    } finally {
      setDetectingOllama(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" color="primary" />
      </div>
    );
  }

  const hasAnyConfigured = (config?.providers ?? []).some(
    p => p.hasApiKey || p.id === "ollama" || (p.baseUrl && p.baseUrl.trim()),
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
          {applying ? "Applying..." : "Apply to components"}
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
       * Unified providers list
       * -------------------------------------------------------------- */}
      {(() => {
        const providers = config?.providers ?? [];
        if (providers.length === 0) return null;
        return (
          <div className="space-y-3">
            {providers.map(p => {
            const isEditing = !!editing[p.id];
            const editState = editing[p.id] ?? {};
            const isDefault = config?.defaultProvider === p.id;
            const ok = p.id === "ollama" || p.hasApiKey || (p.baseUrl && p.baseUrl.trim());
            const pid = p.id;
            return (
              <Surface key={p.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className={"mt-1 inline-block h-2 w-2 rounded-full " + (ok ? "bg-primary" : "bg-default-300")} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{getProviderLabel(pid)}</span>
                        {isDefault && <Chip size="sm" color="primary" variant="flat" radius="sm" startContent={<Check className="h-3 w-3"/>}>default</Chip>}
                        {p.isCustom && <Chip size="sm" variant="flat" radius="sm" classNames={{content: "px-1 text-[10px] font-medium uppercase tracking-wider text-default-400"}}>custom</Chip>}
                        {!p.enabled && <Chip size="sm" variant="flat" radius="sm" classNames={{content: "px-1 text-[10px] font-medium uppercase tracking-wider text-default-500"}}>disabled</Chip>}
                      </div>
                      {p.isCustom && <p className="mt-0.5 text-xs text-default-500">OpenAI-compatible endpoint</p>}
                      {p.baseUrl && !p.isCustom && (
                        <p className="mt-1 font-mono text-[11px] text-default-400">{p.baseUrl}</p>
                      )}
                      {!p.isCustom && p.id !== "ollama" && (
                        <p className="mt-1 font-mono text-[11px] text-default-400">
                          {p.hasApiKey ? p.apiKeyMasked : "no key set"}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!isDefault && ok && (
                      pendingDefault === pid ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-default-500">Set as default?</span>
                          <Button size="sm" color="primary" variant="flat" radius="md" isLoading={savingId === `default-${pid}`} onPress={() => { void setDefault(pid); setPendingDefault(null); }}>Yes</Button>
                          <Button size="sm" variant="light" radius="md" onPress={() => setPendingDefault(null)}>No</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="light" radius="md" onPress={() => setPendingDefault(pid)} className="text-default-600 hover:text-foreground">
                          Set default
                        </Button>
                      )
                    )}
                    <Button size="sm" variant="light" radius="md" isIconOnly onPress={() => removeProvider(pid)} isDisabled={!!savingId} className="text-default-400 hover:text-danger">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Ollama: model discovery on card */}
                {p.id === "ollama" && !isEditing && (
                  <div className="mt-3">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="flat"
                        radius="md"
                        isLoading={cardDetectingOllama === pid}
                        onPress={() => void detectOllamaModelsForCard(pid, p.baseUrl ?? "http://localhost:11434")}
                        className="text-default-600"
                      >
                        Detect models
                      </Button>
                      {(cardOllamaModels[pid] ?? []).length > 0 && (
                        <span className="text-[11px] text-default-400">{cardOllamaModels[pid].length} model(s) available</span>
                      )}
                    </div>
                    {(cardOllamaModels[pid] ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {cardOllamaModels[pid].map(m => (
                          <Chip key={m} size="sm" variant="flat" radius="sm" className="h-5 px-1.5 font-mono text-[10px]">
                            {m}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Test result (kept visible during retests with loading overlay) */}
                {(() => {
                  const tr = testResults[p.id];
                  const isTesting = testingId === p.id;
                  if (!tr && !isTesting) return null;
                  if (!tr && isTesting) return (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-divider px-3 py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-default-400" />
                      <span className="text-xs text-default-400">Testing…</span>
                    </div>
                  );
                  if (!tr) return null;
                  return (
                    <div className={`relative mt-3 rounded-lg border px-3 py-2 ${
                      tr.ok ? "border-success/20 bg-success/5" : "border-danger/20 bg-danger/5"
                    }`}>
                      {isTesting && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-content1/60 backdrop-blur-[1px]">
                          <Loader2 className="h-4 w-4 animate-spin text-default-400" />
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        {tr.ok ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-danger" />
                        )}
                        <span className="text-xs">
                          {tr.ok ? `${tr.modelCount} model(s) · ${tr.latency}ms` : tr.error}
                        </span>
                      </div>
                      {tr.ok && (tr.models?.length ?? 0) > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(tr.models ?? []).slice(0, 8).map(m => (
                            <Chip key={m} size="sm" variant="flat" radius="sm" className="h-5 px-1.5 text-[10px]">
                              {m}
                            </Chip>
                          ))}
                          {tr.modelCount > 8 && (
                            <Chip size="sm" variant="flat" radius="sm" className="h-5 px-1.5 text-[10px] text-default-400">
                              +{tr.modelCount - 8} more
                            </Chip>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Edit fields */}
                {isEditing && (
                  <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {!p.isCustom && p.id !== "ollama" && (
                      <Input label="API key" labelPlacement="outside" placeholder={p.apiKeyMasked ?? "Enter new key"} value={editState.apiKey ?? ""} onValueChange={v => setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], apiKey: v }}))} type="password" variant="bordered" classNames={{ input: "font-mono text-sm" }} />
                    )}
                    {p.isCustom && (
                      <>
                        <Input label="Name" labelPlacement="outside" placeholder={p.name ?? "e.g. Local LLaMA"} value={editState.name ?? ""} onValueChange={v => setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], name: v }}))} variant="bordered" classNames={{ input: "text-sm" }} />
                        <Input label="Base URL" labelPlacement="outside" placeholder="https://..." value={editState.baseUrl ?? p.baseUrl ?? ""} onValueChange={v => setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], baseUrl: v }}))} variant="bordered" classNames={{ input: "font-mono text-sm" }} />
                        <Input label="API key (optional)" labelPlacement="outside" placeholder={p.apiKeyMasked ?? "Bearer token or API key"} value={editState.apiKey ?? ""} onValueChange={v => setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], apiKey: v }}))} type="password" variant="bordered" classNames={{ input: "font-mono text-sm" }} />
                      </>
                    )}
                    {p.id === "ollama" && (
                      <Input label="Ollama URL" labelPlacement="outside" placeholder="http://localhost:11434" value={editState.baseUrl ?? p.baseUrl ?? "http://localhost:11434"} onValueChange={v => setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], baseUrl: v }}))} variant="bordered" classNames={{ input: "font-mono text-sm" }} />
                    )}
                    <Input label="Default model" labelPlacement="outside" placeholder={DEFAULT_MODEL_PLACEHOLDERS[p.id] ?? "model-name"} value={editState.defaultModel ?? p.defaultModel ?? ""} onValueChange={v => setEditing(prev => ({ ...prev, [p.id]: { ...prev[p.id], defaultModel: v }}))} variant="bordered" classNames={{ input: "font-mono text-sm" }} />
                  </div>
                )}

                {/* Footer */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-4">
                  <Switch size="sm" isSelected={p.enabled} onValueChange={v => void saveProvider(pid, { enabled: v })}>
                    <span className="text-xs text-default-500">Enabled</span>
                  </Switch>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="light"
                      radius="md"
                      className="text-default-500"
                      isDisabled={!!savingId || (!p.hasApiKey && !p.baseUrl && p.id !== "ollama")}
                      isLoading={testingId === p.id}
                      startContent={testingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Beaker className="h-3.5 w-3.5" />}
                      onPress={() => void testProvider(pid)}
                    >
                      Test
                    </Button>
                    {isEditing ? (
                      <>
                        <Button size="sm" variant="light" radius="md" onPress={() => setEditing(prev => { const n = { ...prev }; delete n[p.id]; return n; })}>Cancel</Button>
                        <Button size="sm" color="primary" radius="md" startContent={<Save className="h-3.5 w-3.5"/>} isLoading={savingId === p.id} onPress={() => void saveProvider(pid, { ...(editState.apiKey ? { apiKey: editState.apiKey } : {}), ...(editState.defaultModel ? { defaultModel: editState.defaultModel } : {}), ...(editState.baseUrl ? { baseUrl: editState.baseUrl } : {}), ...(editState.name ? { name: editState.name } : {}) })}>Save</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="bordered" radius="md" onPress={() => setEditing(prev => ({ ...prev, [p.id]: {} }))}>Edit</Button>
                    )}
                  </div>
                </div>
              </Surface>
            );
          })}
        </div>
        );
      })()}

      {/* -----------------------------------------------------------------
       * Add provider (unified)
       * -------------------------------------------------------------- */}
      {!adding ? (
        <button
          type="button"
          onClick={() => { setAdding({ isCustom: false }); setOllamaModels([]); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-divider bg-content1/40 px-4 py-4 text-sm text-default-500 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          Add a provider
        </button>
      ) : (
        <Surface className="p-5">
          <h3 className="font-medium text-foreground">Add a provider</h3>
          <p className="mt-0.5 text-xs text-default-500">
            Configure the key, set a default model, then save. Changes apply to components automatically.
          </p>

          <div className="mt-4 space-y-5">
            {/* Type toggle */}
            <Select
              label="Type"
              labelPlacement="outside"
              variant="bordered"
              selectedKeys={adding.isCustom ? new Set(["custom"]) : new Set(["builtin"])}
              onSelectionChange={keys => {
                const isCustom = Array.from(keys).includes("custom");
                setAdding({ isCustom, apiKey: "", defaultModel: "", baseUrl: "", name: "" });
                setOllamaModels([]);
              }}
            >
              <SelectItem key="builtin">Built-in provider</SelectItem>
              <SelectItem key="custom">Custom OpenAI-compatible endpoint</SelectItem>
            </Select>

            {/* Built-in: pick a provider */}
            {!adding.isCustom && (
              <div>
                <p className="mb-2 text-xs font-medium text-default-500">Provider</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {BUILT_IN_DEFS.map(def => (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => {
                        setAdding(prev => ({
                          ...prev!,
                          id: def.id,
                          apiKey: "",
                          defaultModel: DEFAULT_MODEL_PLACEHOLDERS[def.id] ?? "",
                          baseUrl: def.defaultBaseUrl,
                        }));
                        setOllamaModels([]);
                      }}
                      className={`flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                        adding.id === def.id
                          ? "border-primary/60 bg-primary/5"
                          : "border-divider hover:border-default-300 hover:bg-content2"
                      }`}
                    >
                      <span className="text-sm font-medium text-foreground">{def.name}</span>
                      <span className="text-[11px] text-default-400">{def.tagline}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Built-in fields */}
            {!adding.isCustom && adding.id && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {adding.id !== "ollama" && (
                  <Input
                    label="API key"
                    labelPlacement="outside"
                    placeholder={KEY_PLACEHOLDERS[adding.id] ?? "sk-..."}
                    value={adding.apiKey ?? ""}
                    onValueChange={v => setAdding(prev => ({ ...prev!, apiKey: v }))}
                    type="password"
                    variant="bordered"
                    classNames={{ input: "font-mono text-sm" }}
                  />
                )}
                {adding.id === "ollama" && (
                  <div className="sm:col-span-2 space-y-2">
                    <div className="flex items-end gap-2">
                      <Input
                        label="Ollama URL"
                        labelPlacement="outside"
                        placeholder="http://localhost:11434"
                        value={adding.baseUrl ?? "http://localhost:11434"}
                        onValueChange={v => setAdding(prev => ({ ...prev!, baseUrl: v }))}
                        variant="bordered"
                        classNames={{ input: "font-mono text-sm" }}
                        className="flex-1"
                      />
                      <Button
                        size="sm"
                        variant="bordered"
                        radius="md"
                        isLoading={detectingOllama}
                        className="shrink-0 mb-0.5"
                        onPress={() => void detectOllamaModels()}
                      >
                        Detect models
                      </Button>
                    </div>
                    {ollamaModels.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {ollamaModels.map(m => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setAdding(prev => ({ ...prev!, defaultModel: m }))}
                            className={`rounded px-2 py-0.5 text-[11px] font-mono transition-colors border ${
                              adding.defaultModel === m
                                ? "border-primary/60 bg-primary/10 text-primary"
                                : "border-divider text-default-500 hover:border-default-300 hover:text-foreground"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <Input
                  label="Default model"
                  labelPlacement="outside"
                  placeholder={DEFAULT_MODEL_PLACEHOLDERS[adding.id] ?? "model-name"}
                  value={adding.defaultModel ?? ""}
                  onValueChange={v => setAdding(prev => ({ ...prev!, defaultModel: v }))}
                  variant="bordered"
                  classNames={{ input: "font-mono text-sm" }}
                />
              </div>
            )}

            {/* Custom fields */}
            {adding.isCustom && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Name"
                  labelPlacement="outside"
                  placeholder="e.g. Local LLaMA"
                  value={adding.name ?? ""}
                  onValueChange={v => setAdding(prev => ({ ...prev!, name: v }))}
                  variant="bordered"
                  classNames={{ input: "text-sm" }}
                />
                <Input
                  label="Base URL"
                  labelPlacement="outside"
                  placeholder="https://..."
                  value={adding.baseUrl ?? ""}
                  onValueChange={v => setAdding(prev => ({ ...prev!, baseUrl: v }))}
                  variant="bordered"
                  classNames={{ input: "font-mono text-sm" }}
                />
                <Input
                  label="API key (optional)"
                  labelPlacement="outside"
                  placeholder="Bearer token or API key"
                  value={adding.apiKey ?? ""}
                  onValueChange={v => setAdding(prev => ({ ...prev!, apiKey: v }))}
                  type="password"
                  variant="bordered"
                  classNames={{ input: "font-mono text-sm" }}
                />
                <Input
                  label="Default model"
                  labelPlacement="outside"
                  placeholder="e.g. llama3.1:8b"
                  value={adding.defaultModel ?? ""}
                  onValueChange={v => setAdding(prev => ({ ...prev!, defaultModel: v }))}
                  variant="bordered"
                  classNames={{ input: "font-mono text-sm" }}
                />
              </div>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2 border-t border-divider pt-4">
            <Button size="sm" variant="light" radius="md" onPress={() => { setAdding(null); setOllamaModels([]); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              color="primary"
              radius="md"
              isLoading={!!savingId}
              startContent={<Save className="h-3.5 w-3.5" />}
              onPress={() => {
                if (adding.isCustom) {
                  if (!adding.name?.trim() || !adding.baseUrl?.trim()) {
                    addToast({ title: "Name and base URL are required", color: "danger" });
                    return;
                  }
                  void saveProvider(`custom-${Date.now()}`, {
                    isCustom: true,
                    name: adding.name,
                    baseUrl: adding.baseUrl,
                    ...(adding.apiKey ? { apiKey: adding.apiKey } : {}),
                    defaultModel: adding.defaultModel,
                  });
                  return;
                }
                if (!adding.id) {
                  addToast({ title: "Select a provider first", color: "danger" });
                  return;
                }
                if (adding.id !== "ollama" && !adding.apiKey?.trim()) {
                  addToast({ title: "API key is required for this provider", color: "danger" });
                  return;
                }
                void saveProvider(adding.id, {
                  ...(adding.apiKey ? { apiKey: adding.apiKey } : {}),
                  ...(adding.baseUrl ? { baseUrl: adding.baseUrl } : {}),
                  defaultModel: adding.defaultModel,
                });
              }}
            >
              Add provider
            </Button>
          </div>
        </Surface>
      )}

      {/* -----------------------------------------------------------------
       * Per-service routing
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
                (p: ProviderEntry) => p.id === "ollama" || p.hasApiKey || (p.baseUrl && p.baseUrl.trim()),
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
                          ? `Routes via ${getProviderLabel(effective)}`
                          : "No provider — pick one above first"}
                        {modelOverride && ` · model: ${modelOverride}`}
                      </p>
                      {/* Last applied timestamp / not-yet-applied hint */}
                      {config?.wiringStatus?.[c.id] ? (
                        <p className="mt-0.5 text-[10px] text-default-400">
                          Last applied: {formatTimestamp(config.wiringStatus[c.id].lastApplied)}
                          {" · "}
                          <span className={config.wiringStatus[c.id].outcome === "ok" ? "text-success" : "text-danger"}>
                            {config.wiringStatus[c.id].outcome}
                          </span>
                        </p>
                      ) : c.installed && effective ? (
                        <p className="mt-0.5 text-[10px] text-warning">
                          Not yet applied — click &ldquo;Apply to components&rdquo; to push this config
                        </p>
                      ) : null}
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
                            : sel;
                          if (next === (override ?? null)) return;
                          void setServiceProvider(c.id, next);
                        }}
                      >
                        {[
                          <SelectItem key="__default__">Use global default</SelectItem>,
                          ...usable.map(p => (
                            <SelectItem key={p.id}>{getProviderLabel(p.id)}</SelectItem>
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
       * Help
       * -------------------------------------------------------------- */}
      <section className="rounded-xl border border-divider bg-content1/60 p-5 text-sm text-default-500">
        <p className="font-medium text-foreground">How this works</p>
        <p className="mt-2">
          Eve stores provider keys once and propagates them to every installed component:
        </p>
        <ul className="mt-2 space-y-1">
          <li className="flex gap-2"><span className="text-default-400">→</span> Synap IS receives upstream provider keys (Anthropic / OpenAI / OpenRouter).</li>
          <li className="flex gap-2"><span className="text-default-400">→</span> OpenClaw is wired to use Synap IS as its OpenAI-compat backend.</li>
          <li className="flex gap-2"><span className="text-default-400">→</span> Open WebUI and Hermes are wired to use the configured providers.</li>
          <li className="flex gap-2"><span className="text-default-400">→</span> Custom OpenAI-compatible providers are appended as additional model sources.</li>
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
