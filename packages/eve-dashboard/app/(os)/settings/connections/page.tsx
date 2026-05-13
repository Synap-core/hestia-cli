"use client";

import { useEffect, useState, useCallback } from "react";
import { Chip, Button, Input, addToast } from "@heroui/react";
import { RefreshCw, Plug2, Terminal, CheckCircle2, Circle, Copy, Eye, EyeOff, ExternalLink } from "lucide-react";
import type { ConnectionsState } from "@/app/api/connections/route";
import type { RegisterIntegrationRequest } from "@/app/api/connections/register/route";

// ---------------------------------------------------------------------------
// Service catalog
// ---------------------------------------------------------------------------

type ServiceId =
  | "google" | "github" | "slack" | "notion"
  | "hubspot" | "linear" | "attio" | "salesforce"
  | "airtable" | "jira";

interface Service {
  id: ServiceId;
  label: string;
  description: string;
  category: string;
  color: string;
  icon: React.ReactNode;
  setupLink: string;
  setupLabel: string;
  nangoProvider: string;
  defaultScopes: string;
}

function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}

function SlackIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  );
}

function NotionIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
    </svg>
  );
}

const SERVICES: Service[] = [
  {
    id: "google",
    label: "Google",
    description: "Contacts, Calendar, Gmail, Drive — sync with your pod",
    category: "Productivity",
    color: "#ffffff",
    icon: <GoogleIcon size={18} />,
    setupLink: "https://console.cloud.google.com/apis/credentials",
    setupLabel: "Google Cloud Console",
    nangoProvider: "google",
    defaultScopes: "openid profile email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/calendar.readonly",
  },
  {
    id: "github",
    label: "GitHub",
    description: "Repos, issues, pull requests, notifications",
    category: "Development",
    color: "#24292f",
    icon: <GitHubIcon size={18} />,
    setupLink: "https://github.com/settings/developers",
    setupLabel: "GitHub Developer Settings",
    nangoProvider: "github",
    defaultScopes: "repo user notifications read:org",
  },
  {
    id: "slack",
    label: "Slack",
    description: "Messages, channels, and workspace activity",
    category: "Communication",
    color: "#4A154B",
    icon: <SlackIcon size={18} />,
    setupLink: "https://api.slack.com/apps",
    setupLabel: "Slack API Console",
    nangoProvider: "slack",
    defaultScopes: "channels:read chat:write users:read files:read",
  },
  {
    id: "notion",
    label: "Notion",
    description: "Pages, databases, and workspace content",
    category: "Productivity",
    color: "#000000",
    icon: <NotionIcon size={18} />,
    setupLink: "https://www.notion.so/my-integrations",
    setupLabel: "Notion Integrations",
    nangoProvider: "notion",
    defaultScopes: "read_content",
  },
  {
    id: "hubspot",
    label: "HubSpot",
    description: "CRM contacts, deals, companies, and activity",
    category: "CRM",
    color: "#ff7a59",
    icon: <span className="text-white font-bold text-sm">H</span>,
    setupLink: "https://developers.hubspot.com/get-started",
    setupLabel: "HubSpot Developer Portal",
    nangoProvider: "hubspot",
    defaultScopes: "crm.objects.contacts.read crm.objects.deals.read crm.objects.companies.read",
  },
  {
    id: "linear",
    label: "Linear",
    description: "Issues, projects, and engineering workflows",
    category: "Development",
    color: "#5e6ad2",
    icon: <span className="text-white font-bold text-sm">L</span>,
    setupLink: "https://linear.app/settings/api",
    setupLabel: "Linear API Settings",
    nangoProvider: "linear",
    defaultScopes: "read",
  },
  {
    id: "attio",
    label: "Attio",
    description: "CRM records, lists, and workspace data",
    category: "CRM",
    color: "#1a1a2e",
    icon: <span className="text-white font-bold text-sm">A</span>,
    setupLink: "https://app.attio.com/settings/integrations/oauth-apps",
    setupLabel: "Attio OAuth Apps",
    nangoProvider: "attio",
    defaultScopes: "record_permission:read list_entry:read",
  },
  {
    id: "airtable",
    label: "Airtable",
    description: "Bases, tables, and structured data",
    category: "Productivity",
    color: "#18bfff",
    icon: <span className="text-white font-bold text-sm">At</span>,
    setupLink: "https://airtable.com/create/oauth",
    setupLabel: "Airtable OAuth",
    nangoProvider: "airtable",
    defaultScopes: "data.records:read schema.bases:read",
  },
  {
    id: "jira",
    label: "Jira",
    description: "Issues, sprints, and project tracking",
    category: "Development",
    color: "#0052CC",
    icon: <span className="text-white font-bold text-sm">J</span>,
    setupLink: "https://developer.atlassian.com/console/myapps/",
    setupLabel: "Atlassian Developer Console",
    nangoProvider: "jira",
    defaultScopes: "read:jira-work read:jira-user offline_access",
  },
  {
    id: "salesforce",
    label: "Salesforce",
    description: "Leads, accounts, opportunities, and CRM data",
    category: "CRM",
    color: "#00A1E0",
    icon: <span className="text-white font-bold text-sm">SF</span>,
    setupLink: "https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm",
    setupLabel: "Salesforce Connected Apps",
    nangoProvider: "salesforce",
    defaultScopes: "api refresh_token offline_access",
  },
];

const CATEGORIES = ["All", "CRM", "Productivity", "Development", "Communication"];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConnectionsPage() {
  const [state, setState] = useState<ConnectionsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");

  const fetchState = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connections", { credentials: "include" });
      if (res.ok) setState(await res.json() as ConnectionsState);
    } catch {
      addToast({ title: "Could not load connections", color: "danger" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchState(); }, [fetchState]);

  const filtered = filter === "All"
    ? SERVICES
    : SERVICES.filter(s => s.category === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16 text-foreground/40">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        Loading connections…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Plug2 className="h-4 w-4" />
          External Connections
        </h2>
        <p className="text-xs text-foreground/50 mt-1">
          Connect third-party services to your pod. OAuth tokens stay on your server — nothing routes through the cloud.
        </p>
      </div>

      {/* Nango install banner */}
      {!state?.nangoInstalled && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
          <Terminal className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">OAuth bridge not installed</p>
            <p className="text-xs text-foreground/50">
              External connections use Nango, a self-hosted OAuth platform. Install it to enable connecting services.
            </p>
            <code className="inline-block mt-1 rounded-md bg-content2 border border-divider px-2 py-1 font-mono text-xs text-foreground">
              eve add nango
            </code>
          </div>
        </div>
      )}

      {/* Category filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={
              "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
              (filter === cat
                ? "bg-primary text-primary-foreground"
                : "bg-content2 text-foreground/60 hover:text-foreground hover:bg-content3")
            }
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Service grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {filtered.map(service => {
          const connected = state?.connectedApps.includes(service.id) ?? false;
          const registered = state?.registeredIntegrations.find(r => r.key === service.id);
          return (
            <ServiceCard
              key={service.id}
              service={service}
              connected={connected}
              registered={registered}
              nangoInstalled={state?.nangoInstalled ?? false}
              nangoCallbackUrl={state?.nangoCallbackUrl ?? null}
              onSaved={fetchState}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service card
// ---------------------------------------------------------------------------

function ServiceCard({ service, connected, registered, nangoInstalled, nangoCallbackUrl, onSaved }: {
  service: Service;
  connected: boolean;
  registered: { key: string; provider: string; clientIdPreview: string } | undefined;
  nangoInstalled: boolean;
  nangoCallbackUrl: string | null;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState(service.defaultScopes);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const isConfigured = !!registered;

  const handleCopyUri = async () => {
    if (!nangoCallbackUrl) return;
    await navigator.clipboard.writeText(nangoCallbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSave = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      addToast({ title: "Client ID and Client Secret are required", color: "danger" });
      return;
    }
    setSaving(true);
    try {
      const body: RegisterIntegrationRequest = {
        serviceId: service.id,
        nangoProvider: service.nangoProvider,
        clientId,
        clientSecret,
        scopes,
      };
      const res = await fetch("/api/connections/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        addToast({ title: data.error ?? "Failed to save", color: "danger" });
        return;
      }
      addToast({ title: `${service.label} integration saved`, color: "success" });
      setClientId("");
      setClientSecret("");
      setExpanded(false);
      onSaved();
    } catch {
      addToast({ title: "Network error", color: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-foreground/[0.07] bg-content1 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border border-white/10"
          style={{ backgroundColor: service.color }}
        >
          {service.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground leading-none">{service.label}</p>
            <Chip
              size="sm"
              variant="flat"
              color={isConfigured ? "success" : "default"}
              classNames={{ base: "h-4", content: "text-[10px] px-1.5" }}
            >
              {isConfigured ? "configured" : "not configured"}
            </Chip>
          </div>
          <p className="text-[11px] text-foreground/40 mt-0.5 truncate">{service.description}</p>
        </div>
        <Chip size="sm" variant="flat" radius="sm" classNames={{ base: "h-5 shrink-0", content: "text-[10px] px-1.5 text-foreground/40" }}>
          {service.category}
        </Chip>
      </div>

      {/* Status row */}
      <div className="px-4 pb-3 flex items-center gap-2">
        {isConfigured ? (
          <div className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Configured: <span className="font-mono">{registered.clientIdPreview}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-foreground/40">
            <Circle className="h-3.5 w-3.5" />
            Not configured
          </div>
        )}
        <div className="flex-1" />
        {nangoInstalled && (
          <Button
            size="sm"
            variant={expanded ? "flat" : "bordered"}
            color={expanded ? "primary" : "default"}
            radius="md"
            className="h-7 min-w-0 px-3 text-[11px]"
            onPress={() => setExpanded(e => !e)}
          >
            {expanded ? "Hide" : isConfigured ? "Reconfigure" : "Set up"}
          </Button>
        )}
      </div>

      {/* Expanded credential form */}
      {expanded && (
        <div className="border-t border-foreground/[0.06] px-4 py-4 space-y-3 bg-content2/30">
          {/* Redirect URI */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-foreground/40">Redirect URI</p>
            {nangoCallbackUrl ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-[11px] bg-content1 border border-divider rounded-md px-2 py-1.5 text-foreground/70 select-all truncate">
                  {nangoCallbackUrl}
                </code>
                <button
                  onClick={handleCopyUri}
                  className="shrink-0 p-1.5 rounded-md hover:bg-content3 text-foreground/40 hover:text-foreground transition-colors"
                  title="Copy redirect URI"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {copied && <span className="text-[10px] text-success">Copied</span>}
              </div>
            ) : (
              <p className="text-[11px] text-foreground/40">
                Set a domain first — <code className="font-mono">eve domain set</code>
              </p>
            )}
          </div>

          {/* Provider setup link */}
          <div>
            <a
              href={service.setupLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Create OAuth app on {service.setupLabel}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Client ID */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-foreground/40">Client ID</label>
            <Input
              size="sm"
              placeholder="Paste your Client ID"
              value={clientId}
              onValueChange={setClientId}
              classNames={{
                inputWrapper: "bg-content1 border-divider h-8",
                input: "text-xs font-mono",
              }}
            />
          </div>

          {/* Client Secret */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-foreground/40">Client Secret</label>
            <Input
              size="sm"
              placeholder="Paste your Client Secret"
              value={clientSecret}
              onValueChange={setClientSecret}
              type={showSecret ? "text" : "password"}
              classNames={{
                inputWrapper: "bg-content1 border-divider h-8",
                input: "text-xs font-mono",
              }}
              endContent={
                <button
                  onClick={() => setShowSecret(s => !s)}
                  className="text-foreground/40 hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              }
            />
          </div>

          {/* Scopes */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-foreground/40">Scopes</label>
            <Input
              size="sm"
              value={scopes}
              onValueChange={setScopes}
              classNames={{
                inputWrapper: "bg-content1 border-divider h-8",
                input: "text-xs font-mono",
              }}
            />
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              color="primary"
              radius="md"
              className="h-7 px-4 text-[11px]"
              isLoading={saving}
              onPress={handleSave}
            >
              Save integration
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
