"use client";

/**
 * Hermes daemon settings panel.
 *
 * Hermes is a CLI helper, not a container, so the dashboard can't actually
 * start or stop the daemon — that lives on the host. What we *can* do:
 *  - Surface the settings the daemon reads at boot (poll interval, max
 *    concurrent tasks).
 *  - Show the host-side commands the user runs to drive it.
 *
 * This is the "no UI by design" component made tangible: instead of
 * pretending Hermes has an app, we explain how it works and give one
 * clear handle (the daemon settings file) the user can manage from here.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Input, Button, Spinner, Switch, addToast,
} from "@heroui/react";
import { Bot, Terminal } from "lucide-react";

interface HermesConfig {
  enabled: boolean;
  pollIntervalMs: number;
  maxConcurrentTasks: number;
}

export function HermesConfigPanel() {
  const [cfg, setCfg] = useState<HermesConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/components/hermes/config", { credentials: "include" });
      if (res.ok) setCfg(await res.json());
      setLoading(false);
    })();
  }, []);

  const onSave = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch("/api/components/hermes/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(cfg),
      });
      if (res.ok) {
        const next = await res.json() as HermesConfig;
        setCfg(next);
        addToast({ title: "Hermes settings saved", color: "success" });
      }
    } finally { setSaving(false); }
  }, [cfg]);

  return (
    <div className="space-y-4">
      {/* Daemon model explainer */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 text-sm text-default-700 leading-relaxed">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500 mb-2">
          <Bot className="h-3.5 w-3.5" />
          <span>How Hermes works</span>
        </div>
        <p>
          Hermes runs as a polling daemon on the host — not a service the dashboard owns.
          When enabled, it watches Synap for tasks, executes them through OpenClaw + the
          builder organ, and submits results back. There&apos;s no web UI to monitor because
          its surface lives inside the agent conversations that produce the tasks.
        </p>
      </div>

      {/* Settings */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
        <div className="text-xs font-medium uppercase tracking-wider text-default-500">
          Daemon settings
        </div>
        {loading || !cfg ? (
          <div className="flex justify-center py-3"><Spinner size="sm" /></div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Switch
                size="sm"
                isSelected={cfg.enabled}
                onValueChange={(v) => setCfg({ ...cfg, enabled: v })}
              />
              <div className="text-sm">
                <span className="text-foreground">Enabled</span>
                <span className="block text-xs text-default-500">
                  When off, the daemon refuses to start until you flip this back on.
                </span>
              </div>
            </div>
            <Input
              size="sm"
              variant="bordered"
              type="number"
              label="Poll interval (ms)"
              labelPlacement="outside"
              description="How often Hermes asks Synap for new tasks."
              value={String(cfg.pollIntervalMs)}
              onValueChange={(v) =>
                setCfg({ ...cfg, pollIntervalMs: Number.parseInt(v, 10) || cfg.pollIntervalMs })
              }
            />
            <Input
              size="sm"
              variant="bordered"
              type="number"
              label="Max concurrent tasks"
              labelPlacement="outside"
              description="How many tasks Hermes runs in parallel. Default 1."
              value={String(cfg.maxConcurrentTasks)}
              onValueChange={(v) =>
                setCfg({ ...cfg, maxConcurrentTasks: Number.parseInt(v, 10) || cfg.maxConcurrentTasks })
              }
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
          </>
        )}
      </div>

      {/* Host CLI commands */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <Terminal className="h-3.5 w-3.5" />
          <span>Run on the host</span>
        </div>
        <div className="space-y-2">
          <CliCommand command="eve builder hermes start" hint="Start the polling daemon" />
          <CliCommand command="eve builder hermes stop" hint="Stop the daemon" />
          <CliCommand command="eve builder hermes status" hint="Show stats (running, polls, tasks)" />
          <CliCommand command="eve builder hermes poll" hint="Run one poll cycle and exit" />
        </div>
      </div>
    </div>
  );
}

function CliCommand({ command, hint }: { command: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-divider bg-content1 px-3 py-2">
      <code className="flex-1 font-mono text-xs text-foreground">{command}</code>
      <span className="text-[11px] text-default-500 hidden sm:block">{hint}</span>
      <Button
        size="sm"
        variant="light"
        radius="md"
        onPress={() => {
          void navigator.clipboard.writeText(command).then(() => {
            addToast({ title: "Copied", color: "success" });
          });
        }}
      >
        Copy
      </Button>
    </div>
  );
}
