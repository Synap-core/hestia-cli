"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip, Textarea } from "@heroui/react";
import { Play, Square, Trash2, Save } from "lucide-react";
import { terminalSidecarWsUrl } from "../lib/agent-terminal-map";
import { useXterm } from "./use-xterm";

interface RecipeRunnerPanelProps {
  slug: string;
}

interface RecipeStep {
  command: string;
  args: string[];
  cwd?: string;
}

type RunState = "idle" | "connecting" | "running" | "done" | "error" | "aborted";

interface SavedRecipe {
  id: string;
  name: string;
  text: string;
  savedAt: string;
}

const HISTORY_KEY_PREFIX = "eve-dashboard:recipe-history:";

const PRESETS: Record<string, { label: string; text: string }[]> = {
  hermes: [
    {
      label: "ps + last 50 lines",
      text: `docker ps --filter "name=eve-builder"\ndocker logs --tail 50 eve-builder-hermes 2>&1 || echo "no hermes container"`,
    },
  ],
  "openwebui-pipelines": [
    {
      label: "container info",
      text: `docker inspect --format '{{.State.Status}} pid={{.State.Pid}}' eve-openwebui-pipelines\ndocker exec eve-openwebui-pipelines ls /app/pipelines || true`,
    },
  ],
  openclaw: [
    {
      label: "exec into container",
      text: `docker exec eve-arms-openclaw openclaw --version || true`,
    },
  ],
  eve: [{ label: "eve status", text: `eve status --json || true` }],
  coder: [{ label: "engine version", text: `claude --version 2>&1 || true` }],
};

export function RecipeRunnerPanel({ slug }: RecipeRunnerPanelProps) {
  const [text, setText] = useState<string>("");
  const [state, setState] = useState<RunState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedRecipe[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const termReadyRef = useRef(false);
  const pendingRef = useRef<string[]>([]);

  const { containerRef, termRef } = useXterm({
    readonly: true,
    onReady: (term) => {
      termReadyRef.current = true;
      for (const chunk of pendingRef.current) term.write(chunk);
      pendingRef.current = [];
      term.writeln("\x1b[2mPaste shell-style commands (one per line) and press Run.\x1b[0m");
    },
  });

  // Load history from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY_PREFIX + slug);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedRecipe[];
        if (Array.isArray(parsed)) setHistory(parsed.slice(0, 20));
      }
    } catch {
      /* ignore */
    }
  }, [slug]);

  const writeOut = useCallback(
    (chunk: string) => {
      const normalised = chunk.replace(/(?<!\r)\n/g, "\r\n");
      if (termReadyRef.current && termRef.current) {
        termRef.current.write(normalised);
      } else {
        pendingRef.current.push(normalised);
      }
    },
    [termRef],
  );

  const run = useCallback(() => {
    const steps = parseSteps(text);
    if (steps.length === 0) {
      setErrorMessage("No valid steps. Each line should be a shell command.");
      setState("error");
      return;
    }
    setErrorMessage(null);

    if (termRef.current) {
      termRef.current.clear();
      termRef.current.writeln(`\x1b[36m=== Recipe: ${steps.length} step${steps.length === 1 ? "" : "s"} ===\x1b[0m`);
    }

    const url = terminalSidecarWsUrl("recipe");
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setState("connecting");

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "run", steps }));
    };

    ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (!data) return;
      let msg: unknown;
      try {
        msg = JSON.parse(data);
      } catch {
        writeOut(data);
        return;
      }
      const m = msg as {
        ctl?: boolean;
        type?: string;
        index?: number;
        total?: number;
        command?: string;
        args?: string[];
        data?: string;
        exitCode?: number | null;
        message?: string;
      };
      if (m.ctl) {
        if (m.type === "ready") return;
        if (m.type === "step-start") {
          setState("running");
          writeOut(
            `\r\n\x1b[1;33m── step ${m.index! + 1}/${m.total} ──\x1b[0m \x1b[2m${m.command} ${(m.args ?? []).join(" ")}\x1b[0m\r\n`,
          );
          return;
        }
        if (m.type === "step-end") {
          const code = m.exitCode ?? null;
          const colour = code === 0 ? "32" : "31";
          writeOut(`\r\n\x1b[${colour}m[exit ${code ?? "?"}]\x1b[0m\r\n`);
          return;
        }
        if (m.type === "done") {
          setState("done");
          writeOut(`\r\n\x1b[32m=== done (${m.total} steps) ===\x1b[0m\r\n`);
          return;
        }
        if (m.type === "aborted") {
          setState("aborted");
          writeOut(`\r\n\x1b[31m=== aborted at step ${m.index! + 1} (exit ${m.exitCode}) ===\x1b[0m\r\n`);
          return;
        }
        if (m.type === "error") {
          setState("error");
          setErrorMessage(m.message ?? "recipe error");
          writeOut(`\r\n\x1b[31m[error] ${m.message ?? "unknown"}\x1b[0m\r\n`);
          return;
        }
      }
      // step output
      if (m.type === "stdout" && typeof m.data === "string") {
        writeOut(m.data);
        return;
      }
      if (m.type === "stderr" && typeof m.data === "string") {
        writeOut(m.data);
        return;
      }
    };

    ws.onerror = () => {
      setState("error");
      setErrorMessage("WebSocket error — terminal sidecar may be down");
    };
    ws.onclose = () =>
      setState((prev) => (prev === "running" || prev === "connecting" ? "error" : prev));
  }, [text, termRef, writeOut]);

  const cancel = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "cancel" }));
    }
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    setState("aborted");
  }, []);

  const saveRecipe = useCallback(() => {
    if (!text.trim()) return;
    const item: SavedRecipe = {
      id: crypto.randomUUID(),
      name: text.split("\n")[0].slice(0, 60),
      text,
      savedAt: new Date().toISOString(),
    };
    const next = [item, ...history].slice(0, 20);
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY_PREFIX + slug, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  }, [text, history, slug]);

  const removeFromHistory = useCallback(
    (id: string) => {
      const next = history.filter((h) => h.id !== id);
      setHistory(next);
      try {
        localStorage.setItem(HISTORY_KEY_PREFIX + slug, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [history, slug],
  );

  const presets = PRESETS[slug] ?? [];
  const isRunning = state === "running" || state === "connecting";

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-divider px-4 py-2">
        <span className="text-xs text-default-500">Recipe runner · {slug}</span>
        <StatusChip state={state} />
      </div>

      <div className="grid grid-cols-1 gap-4 border-b border-divider p-4 md:grid-cols-[1fr_280px]">
        <div className="space-y-2">
          <Textarea
            label="Recipe (one shell command per line)"
            placeholder={'docker ps\necho "hello"'}
            minRows={4}
            maxRows={10}
            value={text}
            onValueChange={setText}
            classNames={{ input: "font-mono text-xs" }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              color="primary"
              radius="md"
              startContent={!isRunning ? <Play className="h-3.5 w-3.5" /> : undefined}
              isLoading={isRunning}
              onPress={run}
              isDisabled={isRunning || !text.trim()}
            >
              Run
            </Button>
            {isRunning && (
              <Button
                size="sm"
                color="danger"
                variant="flat"
                radius="md"
                startContent={<Square className="h-3.5 w-3.5" />}
                onPress={cancel}
              >
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              variant="flat"
              radius="md"
              startContent={<Save className="h-3.5 w-3.5" />}
              isDisabled={!text.trim()}
              onPress={saveRecipe}
            >
              Save
            </Button>
            {presets.length > 0 && (
              <div className="ml-auto flex flex-wrap gap-1">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setText(p.text)}
                    className="rounded-md border border-divider bg-content1 px-2 py-1 text-xs text-default-600 hover:border-primary/50 hover:text-primary"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {errorMessage && (
            <p className="text-xs text-danger">{errorMessage}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-default-400">History</p>
          {history.length === 0 ? (
            <p className="text-xs text-default-500">Saved recipes appear here.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {history.map((h) => (
                <li key={h.id} className="group flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setText(h.text)}
                    className="flex-1 truncate rounded-md px-2 py-1 text-left font-mono text-default-700 hover:bg-content2"
                    title={h.text}
                  >
                    {h.name || "(empty)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromHistory(h.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100 text-default-400 hover:text-danger"
                    aria-label="Delete saved recipe"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div ref={containerRef} className="h-[50vh] min-h-[320px] w-full" style={{ background: "#0d1117" }} />
    </div>
  );
}

/**
 * Parse one-command-per-line into RecipeStep[]. Splits on whitespace; supports
 * basic single/double-quoted args. Lines starting with `#` are comments.
 */
function parseSteps(text: string): RecipeStep[] {
  const out: RecipeStep[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = tokenise(line);
    if (tokens.length === 0) continue;
    out.push({ command: tokens[0], args: tokens.slice(1) });
  }
  return out;
}

function tokenise(line: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === " " || c === "\t") {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur.length > 0) tokens.push(cur);
  return tokens;
}

function StatusChip({ state }: { state: RunState }) {
  const map: Record<RunState, { color: "success" | "warning" | "danger" | "default"; label: string }> = {
    idle: { color: "default", label: "idle" },
    connecting: { color: "warning", label: "connecting" },
    running: { color: "warning", label: "running" },
    done: { color: "success", label: "done" },
    error: { color: "danger", label: "error" },
    aborted: { color: "danger", label: "aborted" },
  };
  const { color, label } = map[state];
  return (
    <Chip size="sm" color={color} variant="flat">
      {label}
    </Chip>
  );
}
