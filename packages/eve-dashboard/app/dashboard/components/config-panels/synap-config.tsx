"use client";

/**
 * Synap pod info panel.
 *
 * Read-only surface of "what is this pod" — the pod URL, the admin
 * bootstrap state, the docker volumes the operator might back up. Most
 * Synap operations (workspace management, AI provider setup, user
 * accounts) live inside Synap itself, accessible via the drawer's "Open"
 * button or the Open WebUI chat front-end.
 */

import { useEffect, useState } from "react";
import {
  Spinner, Chip, Button, addToast,
} from "@heroui/react";
import { Database, ExternalLink, Copy, Play, Loader2 } from "lucide-react";

interface SynapInfo {
  podUrl: string | null;
  hubBaseUrl: string | null;
  apiKeyPresent: boolean;
  domain: string | null;
  ssl: boolean;
  adminEmail: string | null;
  adminBootstrapMode: "token" | "preseed" | null;
  state: string | null;
  version: string | null;
  volumes: Array<{ name: string; driver: string; size: string | null }>;
}

export function SynapConfigPanel() {
  const [info, setInfo] = useState<SynapInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/components/synap/info", { credentials: "include" });
      if (res.ok) setInfo(await res.json());
      setLoading(false);
    })();
  }, []);

  async function runBackup(volume: string) {
    setBackingUp(volume);
    setProgress([`▶ Backing up ${volume}…`]);
    try {
      const res = await fetch("/api/components/synap/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ volume }),
      });
      if (!res.ok || !res.body) {
        addToast({ title: "Backup failed to start", color: "danger" });
        setBackingUp(null);
        return;
      }
      // Drain the SSE stream into the progress feed.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const messages = buf.split("\n\n");
        buf = messages.pop() ?? "";
        for (const msg of messages) {
          const dataLine = msg.split("\n").find(l => l.startsWith("data:"));
          if (!dataLine) continue;
          const json = dataLine.slice(5).trim();
          if (!json) continue;
          try {
            const ev = JSON.parse(json) as { type: string; line?: string; summary?: string; message?: string };
            if (ev.type === "log" && ev.line) setProgress(p => [...p, ev.line!]);
            else if (ev.type === "step") setProgress(p => [...p, `▶ ${ev.summary ?? ""}`]);
            else if (ev.type === "done" && ev.summary) {
              setProgress(p => [...p, `✓ ${ev.summary!}`]);
              addToast({ title: ev.summary, color: "success" });
            }
            else if (ev.type === "error" && ev.message) {
              setProgress(p => [...p, `✗ ${ev.message!}`]);
              addToast({ title: ev.message, color: "danger" });
            }
          } catch { /* ignore malformed */ }
        }
      }
    } finally { setBackingUp(null); }
  }

  if (loading || !info) {
    return <div className="rounded-lg border border-divider bg-content2/40 p-4"><Spinner size="sm" /></div>;
  }

  const podDashboardUrl = info.domain
    ? `${info.ssl ? "https" : "http"}://pod.${info.domain}`
    : info.podUrl;

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
        <div className="text-xs font-medium uppercase tracking-wider text-default-500">
          Pod identity
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Pod URL" value={podDashboardUrl} mono link />
          <Field label="Hub base URL" value={info.hubBaseUrl} mono />
          <Field
            label="API key"
            value={info.apiKeyPresent ? "configured" : "(not set)"}
            chip={info.apiKeyPresent ? "success" : "default"}
          />
          <Field
            label="Admin email"
            value={info.adminEmail ?? "(not set)"}
            mono={Boolean(info.adminEmail)}
          />
          <Field
            label="Admin bootstrap"
            value={info.adminBootstrapMode ?? "(not set)"}
          />
          {info.version && (
            <Field label="Version" value={`v${info.version}`} mono />
          )}
        </div>
        {podDashboardUrl && (
          <Button
            as="a"
            href={podDashboardUrl}
            target="_blank"
            rel="noreferrer"
            size="sm"
            color="primary"
            radius="md"
            startContent={<ExternalLink className="h-3.5 w-3.5" />}
          >
            Open Synap dashboard
          </Button>
        )}
      </div>

      {/* Volumes — backup candidates */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <Database className="h-3.5 w-3.5" />
          <span>Docker volumes (backup candidates)</span>
        </div>
        {info.volumes.length === 0 ? (
          <p className="text-sm text-default-500">No matching volumes found.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-divider bg-content1">
            {info.volumes.map((v, i) => (
              <div
                key={v.name}
                className={
                  "flex items-center gap-3 px-3 py-2 " +
                  (i === 0 ? "" : "border-t border-divider")
                }
              >
                <code className="flex-1 font-mono text-xs text-foreground truncate">{v.name}</code>
                <span className="text-[11px] text-default-500">{v.driver}</span>
                <Button
                  size="sm"
                  variant="bordered"
                  color="primary"
                  radius="md"
                  startContent={
                    backingUp === v.name
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Play className="h-3.5 w-3.5" />
                  }
                  isLoading={backingUp === v.name}
                  isDisabled={backingUp !== null && backingUp !== v.name}
                  onPress={() => void runBackup(v.name)}
                >
                  Run backup
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  radius="md"
                  startContent={<Copy className="h-3.5 w-3.5" />}
                  onPress={() => {
                    const cmd = `docker run --rm -v ${v.name}:/data -v $(pwd):/backup alpine tar czf /backup/${v.name}.tar.gz -C /data .`;
                    void navigator.clipboard.writeText(cmd).then(() => {
                      addToast({ title: "Manual backup command copied", color: "success" });
                    });
                  }}
                >
                  Copy cmd
                </Button>
              </div>
            ))}
          </div>
        )}
        {progress.length > 0 && (
          <pre className="max-h-48 overflow-auto rounded-md border border-divider bg-content2 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
            <code>{progress.join("\n")}</code>
          </pre>
        )}
        <p className="text-xs text-default-500">
          Backups land in <code className="font-mono">$EVE_HOME/backups</code> on the host.
          To restore: <code className="font-mono">tar xzf &lt;name&gt;.tar.gz -C /data</code> after creating the volume.
        </p>
      </div>
    </div>
  );
}

function Field({
  label, value, mono, link, chip,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  link?: boolean;
  chip?: "success" | "default";
}) {
  return (
    <div className="rounded-lg border border-divider bg-content1 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-default-400">{label}</p>
      <div className="mt-0.5 truncate">
        {chip ? (
          <Chip size="sm" color={chip === "success" ? "success" : "default"} variant="flat" radius="sm">
            {value}
          </Chip>
        ) : link && value ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className={
              "inline-flex items-center gap-1 hover:text-primary " +
              (mono ? "font-mono text-xs" : "text-sm") + " text-foreground"
            }
          >
            {value}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className={
            (mono ? "font-mono text-xs" : "text-sm") + " text-foreground"
          }>{value ?? "—"}</span>
        )}
      </div>
    </div>
  );
}
