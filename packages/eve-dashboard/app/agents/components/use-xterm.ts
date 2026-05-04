"use client";

import { useEffect, useRef } from "react";

/**
 * Minimal xterm.js + fit-addon hook. Returns a ref you mount on a div.
 * The terminal is created on first mount, addons attached, then `onReady`
 * is called with the term + fit addon so the caller can wire WS handlers.
 *
 * We deliberately don't expose Terminal at the type level here — the
 * caller imports xterm types directly when it needs them. This keeps the
 * hook a thin loader and avoids re-exporting third-party types.
 */
export function useXterm(opts: {
  readonly?: boolean;
  onReady: (term: import("@xterm/xterm").Terminal, fit: import("@xterm/addon-fit").FitAddon) => void;
  onResize?: (cols: number, rows: number) => void;
  onData?: (data: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
    ]).then(([{ Terminal }, { FitAddon }]) => {
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: !opts.readonly,
        disableStdin: !!opts.readonly,
        fontSize: 13,
        fontFamily: 'var(--font-mono), "JetBrains Mono", "Fira Code", monospace',
        theme: {
          background: "#0d1117",
          foreground: "#e6edf3",
          cursor: opts.readonly ? "transparent" : "#58a6ff",
          selectionBackground: "#264f78",
        },
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      termRef.current = term;
      fitRef.current = fit;

      if (opts.onData) term.onData(opts.onData);
      if (opts.onResize) term.onResize(({ cols, rows }) => opts.onResize?.(cols, rows));

      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      });
      ro.observe(containerRef.current);

      opts.onReady(term, fit);

      // Cleanup
      return () => {
        ro.disconnect();
        try {
          term.dispose();
        } catch {
          /* ignore */
        }
      };
    });

    return () => {
      disposed = true;
      try {
        termRef.current?.dispose();
      } catch {
        /* ignore */
      }
      termRef.current = null;
      fitRef.current = null;
    };
    // We intentionally do NOT depend on the option callbacks — the caller
    // is expected to keep them stable for the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, termRef, fitRef };
}
