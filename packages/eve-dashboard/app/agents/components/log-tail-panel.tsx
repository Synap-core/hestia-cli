"use client";

import { useEffect, useRef, useState } from "react";
import { Chip } from "@heroui/react";
import { Wifi, WifiOff } from "lucide-react";
import { terminalSidecarWsUrl } from "../lib/agent-terminal-map";
import { useXterm } from "./use-xterm";

interface LogTailPanelProps {
  slug: string;
}

type ConnState = "connecting" | "ready" | "exited" | "error" | "closed";

export function LogTailPanel({ slug }: LogTailPanelProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<string[]>([]);
  const termReadyRef = useRef(false);
  const [state, setState] = useState<ConnState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { containerRef, termRef } = useXterm({
    readonly: true,
    onReady: (term) => {
      termReadyRef.current = true;
      for (const chunk of pendingRef.current) term.write(chunk);
      pendingRef.current = [];
    },
  });

  useEffect(() => {
    const url = terminalSidecarWsUrl("logs", { slug });
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (data.length > 0 && data[0] === "{") {
        try {
          const msg = JSON.parse(data) as { ctl?: boolean; type?: string; message?: string; exitCode?: number | null };
          if (msg.ctl === true) {
            if (msg.type === "ready") setState("ready");
            else if (msg.type === "exit") setState("exited");
            else if (msg.type === "error") {
              setState("error");
              setErrorMessage(msg.message ?? "unknown error");
              if (termRef.current && msg.message) {
                termRef.current.writeln(`\r\n\x1b[31m[error] ${msg.message}\x1b[0m`);
              }
            }
            return;
          }
        } catch {
          /* not JSON */
        }
      }
      // Make stream LF→CRLF so xterm renders newlines correctly.
      const normalised = data.replace(/(?<!\r)\n/g, "\r\n");
      if (termReadyRef.current && termRef.current) {
        termRef.current.write(normalised);
      } else {
        pendingRef.current.push(normalised);
      }
    };

    ws.onerror = () => {
      setState("error");
      setErrorMessage("WebSocket error — terminal sidecar may be down");
    };
    ws.onclose = () => setState((prev) => (prev === "exited" ? "exited" : "closed"));

    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
  }, [slug, termRef]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-divider px-4 py-2">
        <span className="text-xs text-default-500">Log tail · {slug}</span>
        <StatusChip state={state} />
      </div>
      {errorMessage && state === "error" && (
        <div className="border-b border-divider bg-danger/5 px-4 py-2 text-xs text-danger">
          {errorMessage}
        </div>
      )}
      <div ref={containerRef} className="h-[60vh] min-h-[400px] w-full" style={{ background: "#0d1117" }} />
    </div>
  );
}

function StatusChip({ state }: { state: ConnState }) {
  if (state === "ready")
    return (
      <Chip size="sm" color="success" variant="flat" startContent={<Wifi className="h-3 w-3" />}>
        streaming
      </Chip>
    );
  if (state === "connecting")
    return (
      <Chip size="sm" color="warning" variant="flat" startContent={<Wifi className="h-3 w-3" />}>
        connecting
      </Chip>
    );
  if (state === "exited")
    return (
      <Chip size="sm" color="default" variant="flat" startContent={<WifiOff className="h-3 w-3" />}>
        exited
      </Chip>
    );
  if (state === "error")
    return (
      <Chip size="sm" color="danger" variant="flat" startContent={<WifiOff className="h-3 w-3" />}>
        error
      </Chip>
    );
  return (
    <Chip size="sm" color="default" variant="flat" startContent={<WifiOff className="h-3 w-3" />}>
      closed
    </Chip>
  );
}
