"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Send, Sparkles, Bot } from "lucide-react";
import { getSharedSession } from "@/lib/synap-auth";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

let _msgId = 0;
function nextId() { return `msg-${++_msgId}`; }

export interface AgentOverlayProps {
  onClose: () => void;
  /** Contextual scope — which app/entity the agent is scoped to. */
  scope?: string;
}

export function AgentOverlay({ onClose, scope }: AgentOverlayProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const session = getSharedSession();
  const podUrl = session?.podUrl;

  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setMessages((prev) => [...prev, { id: nextId(), role: "user", content: text }]);
    setIsStreaming(true);

    if (!podUrl || !session?.sessionToken) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: "No pod connected. Pair your Eve with a Synap pod to use the agent.",
        },
      ]);
      setIsStreaming(false);
      return;
    }

    try {
      const res = await fetch(`${podUrl}/api/hub/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.sessionToken}`,
        },
        body: JSON.stringify({
          messages: [
            ...(scope ? [{ role: "system", content: `Context: ${scope}` }] : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: text },
          ],
          stream: true,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const assistantId = nextId();
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk?.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + delta } : m,
                ),
              );
            }
          } catch { /* skip malformed chunks */ }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, podUrl, scope, session?.sessionToken]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* Backdrop (click to close) */}
      <motion.div
        className="fixed inset-0 z-30"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <motion.aside
        className="fixed right-0 top-0 z-30 flex h-full w-[360px] flex-col border-l border-white/[0.08] bg-white/[0.04] shadow-2xl backdrop-blur-2xl"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        role="dialog"
        aria-modal
        aria-label="Agent assistant"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-white/[0.08] px-4 py-3.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20">
            <Sparkles className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground/90">Agent</p>
            {scope && (
              <p className="truncate text-[11px] text-foreground/40">{scope}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-white/[0.07] hover:text-foreground/70"
            aria-label="Close agent"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Bot className="h-8 w-8 text-foreground/15" strokeWidth={1.5} />
              <div className="space-y-1">
                <p className="text-[13px] font-medium text-foreground/40">
                  {podUrl ? "How can I help?" : "No pod connected"}
                </p>
                <p className="text-[11.5px] text-foreground/25">
                  {podUrl
                    ? "Ask anything about your data or this app."
                    : "Pair with a Synap pod to use the agent."}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary/20 text-foreground/90"
                        : "bg-white/[0.06] text-foreground/80"
                    }`}
                  >
                    {msg.content || (
                      <span className="inline-flex gap-1 pt-0.5">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="h-1 w-1 animate-bounce rounded-full bg-foreground/40"
                            style={{ animationDelay: `${i * 0.15}s` }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-white/[0.08] p-3">
          <div className="flex items-end gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask anything…"
              rows={1}
              className="max-h-[120px] flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-foreground/30 outline-none"
              style={{ fieldSizing: "content" } as React.CSSProperties}
              disabled={isStreaming}
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || isStreaming}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-white/[0.07] hover:text-primary disabled:pointer-events-none disabled:opacity-30"
              aria-label="Send"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10.5px] text-foreground/20">
            ↵ send · shift+↵ new line · esc close
          </p>
        </div>
      </motion.aside>
    </>
  );
}
