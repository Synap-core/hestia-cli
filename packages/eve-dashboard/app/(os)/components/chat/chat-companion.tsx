"use client";

/**
 * `ChatCompanion` — the native Eve AI chat body, mounted inside the
 * companion shell from `app/(os)/components/companion.tsx`.
 *
 * The shell owns the header (title + close button) and slide-in
 * animation. This component renders only the body:
 *   • scrolling message list (oldest → newest)
 *   • streaming bubble while the assistant is composing
 *   • composer at the bottom (Enter to send, Shift+Enter for newline)
 *
 * All data plumbing lives in `useEveChat`. We deliberately keep the
 * presentation small and dumb: bubbles, an empty state, a loading
 * state, and an error banner. Theming follows the OS shell tokens
 * (`text-foreground/N` opacity tiers, frosted glass surface, no
 * shadows).
 */

import { Button, Spinner, Textarea } from "@heroui/react";
import { ArrowUp, Sparkles } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useEveChat } from "../../lib/chat/use-eve-chat";
import type { ChatMessage, StreamState } from "../../lib/chat/types";

export function ChatCompanion() {
  const {
    messages,
    stream,
    isLoading,
    isSending,
    status,
    sendMessage,
  } = useEveChat();

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages or stream growth.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, stream?.content]);

  if (status.kind === "error" && messages.length === 0) {
    return (
      <ErrorState message={status.message} />
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }

  const showEmpty = messages.length === 0 && !stream && !isSending;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-4"
      >
        {showEmpty ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {stream && !stream.isComplete ? (
              <StreamingBubble stream={stream} />
            ) : null}
          </>
        )}
      </div>
      <Composer onSend={sendMessage} disabled={isSending} />
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/[0.06] ring-1 ring-inset ring-foreground/10"
        aria-hidden
      >
        <Sparkles className="h-5 w-5 text-foreground/55" strokeWidth={1.75} />
      </span>
      <p className="text-[13px] leading-relaxed text-foreground/55 max-w-[260px]">
        Start a conversation with Synap. Ask, capture, or think out loud.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-[13px] font-medium text-foreground">
        Pod unreachable
      </p>
      <p className="text-[12px] leading-relaxed text-foreground/55 max-w-[280px]">
        {message || "Check your connection and sign in to your pod."}
      </p>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-2xl bg-foreground/[0.08] px-3.5 py-2 text-[13.5px] leading-relaxed text-foreground"
            : "max-w-[85%] text-[13.5px] leading-relaxed text-foreground/85"
        }
      >
        <PlainMarkdown content={message.content} />
      </div>
    </div>
  );
}

function StreamingBubble({ stream }: { stream: StreamState }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] text-[13.5px] leading-relaxed text-foreground/85">
        <PlainMarkdown content={stream.content} />
        <span
          className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-foreground/55 animate-pulse"
          aria-hidden
        />
      </div>
    </div>
  );
}

/**
 * Minimal markdown-ish renderer: preserves newlines and fenced code
 * blocks. We intentionally avoid pulling in a full parser (no
 * `react-markdown` in eve-dashboard yet) to keep the surface small.
 */
function PlainMarkdown({ content }: { content: string }) {
  // Split on triple-backtick fences; even segments are prose, odd are code.
  const segments = content.split(/```/g);
  return (
    <>
      {segments.map((seg, i) => {
        if (i % 2 === 1) {
          // Drop optional language tag on first line.
          const lines = seg.split("\n");
          const body = lines.length > 1 ? lines.slice(1).join("\n") : seg;
          return (
            <pre
              key={i}
              className="my-2 overflow-x-auto rounded-md bg-foreground/[0.05] p-3 text-[12px] font-mono text-foreground/85"
            >
              {body}
            </pre>
          );
        }
        return (
          <span key={i} className="whitespace-pre-wrap">
            {seg}
          </span>
        );
      })}
    </>
  );
}

interface ComposerProps {
  onSend: (content: string) => Promise<void> | void;
  disabled: boolean;
}

function Composer({ onSend, disabled }: ComposerProps) {
  const [value, setValue] = useState("");

  // Refocus after a send completes so the composer stays hot.
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!disabled) taRef.current?.focus();
  }, [disabled]);

  const submit = async () => {
    const v = value.trim();
    if (!v || disabled) return;
    setValue("");
    await onSend(v);
  };

  return (
    <div className="shrink-0 border-t border-foreground/[0.05] px-3 py-3">
      <div className="flex items-end gap-2">
        <Textarea
          ref={taRef}
          value={value}
          // HeroUI's Textarea types these handlers against HTMLInputElement;
          // the underlying DOM node is a <textarea>, so a relaxed signature
          // keeps both happy without leaking `any` into the call site.
          onValueChange={setValue}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !(e as { shiftKey: boolean }).shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          minRows={1}
          maxRows={6}
          placeholder="Message Synap…"
          variant="flat"
          radius="lg"
          classNames={{
            inputWrapper:
              "bg-foreground/[0.04] data-[hover=true]:bg-foreground/[0.06] group-data-[focus=true]:bg-foreground/[0.06] border border-foreground/[0.05]",
            input: "text-[13.5px] text-foreground placeholder:text-foreground/40",
          }}
        />
        <Button
          isIconOnly
          size="sm"
          radius="full"
          color="primary"
          aria-label="Send"
          isDisabled={!value.trim() || disabled}
          onPress={() => void submit()}
          className="self-end h-9 w-9 min-w-9"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
        </Button>
      </div>
    </div>
  );
}
