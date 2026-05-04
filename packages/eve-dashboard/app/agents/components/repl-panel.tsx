"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Chip } from "@heroui/react";
import { Wifi, WifiOff } from "lucide-react";
import { terminalSidecarWsUrl } from "../lib/agent-terminal-map";
import { useXterm } from "./use-xterm";

interface ReplPanelProps {
  slug: string;
}

type ConnState = "connecting" | "ready" | "exited" | "error" | "closed";

export function ReplPanel({ slug }: ReplPanelProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const termReadyRef = useRef(false);
  const pendingRef = useRef<string[]>([]);
  const [state, setState] = useState<ConnState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sendData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  const { containerRef, termRef } = useXterm({
    onReady: (term) => {
      termReadyRef.current = true;
      // Drain anything that arrived before the terminal was ready.
      for (const chunk of pendingRef.current) term.write(chunk);
      pendingRef.current = [];
    },
    onData: sendData,
    onResize: sendResize,
  });

  useEffect(() => {
    const url = terminalSidecarWsUrl("repl", { slug });
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setState("connecting");

    ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      // Control frames are JSON with `ctl: true`; everything else is raw bytes.
      if (data.length > 0 && data[0] === "{") {
        try {
          const msg = JSON.parse(data) as { ctl?: boolean; type?: string; message?: string; exitCode?: number | null };
          if (msg.ctl === true) {
            handleCtl(msg);
            return;
          }
        } catch {
          // not JSON — fall through to write
        }
      }
      if (termReadyRef.current && termRef.current) {
        termRef.current.write(data);
      } else {
        pendingRef.current.push(data);
      }
    };

    ws.onerror = () => {
      setState("error");
      setErrorMessage("WebSocket error — terminal sidecar may be down");
    };
    ws.onclose = (ev) => {
      setState((prev) => (prev === "exited" ? "exited" : "closed"));
      if (ev.reason && termRef.current) {
        termRef.current.writeln(`\r\n\x1b[33m[connection closed: ${ev.reason}]\x1b[0m`);
      }
    };

    function handleCtl(msg: { type?: string; message?: string; exitCode?: number | null }) {
      if (msg.type === "ready") {
        setState("ready");
      } else if (msg.type === "exit") {
        setState("exited");
        if (termRef.current) {
          termRef.current.writeln(`\r\n\x1b[36m[process exited code=${msg.exitCode ?? "?"}]\x1b[0m`);
        }
      } else if (msg.type === "error") {
        setState("error");
        setErrorMessage(msg.message ?? "unknown error");
        if (termRef.current && msg.message) {
          termRef.current.writeln(`\r\n\x1b[31m[error] ${msg.message}\x1b[0m`);
        }
      }
    }

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
        <span className="text-xs text-default-500">Subprocess REPL · {slug}</span>
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
  if (state === "ready") {
    return (
      <Chip size="sm" color="success" variant="flat" startContent={<Wifi className="h-3 w-3" />}>
        ready
      </Chip>
    );
  }
  if (state === "connecting") {
    return (
      <Chip size="sm" color="warning" variant="flat" startContent={<Wifi className="h-3 w-3" />}>
        connecting
      </Chip>
    );
  }
  if (state === "exited") {
    return (
      <Chip size="sm" color="default" variant="flat" startContent={<WifiOff className="h-3 w-3" />}>
        exited
      </Chip>
    );
  }
  if (state === "error") {
    return (
      <Chip size="sm" color="danger" variant="flat" startContent={<WifiOff className="h-3 w-3" />}>
        error
      </Chip>
    );
  }
  return (
    <Chip size="sm" color="default" variant="flat" startContent={<WifiOff className="h-3 w-3" />}>
      closed
    </Chip>
  );
}
