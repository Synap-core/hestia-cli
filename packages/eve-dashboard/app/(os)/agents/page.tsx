"use client";

/**
 * Agents app — stub.
 *
 * Phase 3C will replace this with the live n8n-style node graph
 * (Flow view) + chronological Timeline view subscribed to the six
 * `{actor}:{entity}:{action}` events:
 *
 *   • openclaw:message:received
 *   • synap:reply:routed
 *   • hermes:task:queued / started / completed / failed
 *
 * Until then, render a single calm "coming soon" pane that explains
 * what the app will do and links to the existing operational surfaces
 * under Settings (agent terminals, recipe runner) so the operator can
 * still get to the running agents.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 */

import Link from "next/link";
import { Sparkles, Terminal, FileText, ArrowRight } from "lucide-react";
import { PaneHeader } from "../components/pane-header";

export default function AgentsPage() {
  return (
    <>
      <PaneHeader title="Agents" />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <span
          className="
            inline-flex h-16 w-16 items-center justify-center rounded-2xl
          "
          style={{
            background: "linear-gradient(135deg, #10B981, #34D399)",
          }}
        >
          <Sparkles className="h-7 w-7 text-white/95" strokeWidth={1.6} aria-hidden />
        </span>

        <h2 className="mt-6 font-heading text-3xl font-light tracking-tight text-foreground">
          Your AI staff, live
        </h2>
        <p className="mt-3 max-w-[480px] text-sm text-default-500">
          A real-time node graph of OpenClaw, Synap, and Hermes — every
          incoming message, every routed reply, every Hermes task —
          flowing through your sovereign stack.
        </p>
        <p className="mt-1 text-xs text-default-500">
          Coming in Phase 3.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-2 max-w-md w-full">
          <Link
            href="/settings/agents"
            className="
              group flex items-center gap-3 rounded-xl border border-white/[0.08]
              bg-white/[0.04] backdrop-blur-md
              px-4 py-3 text-left
              transition-colors duration-200 hover:bg-white/[0.08]
            "
          >
            <Terminal className="h-4 w-4 text-default-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground">Agent terminals</p>
              <p className="text-[11px] text-default-500">Open REPLs &amp; logs</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-default-400 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Link
            href="/settings/intents"
            className="
              group flex items-center gap-3 rounded-xl border border-white/[0.08]
              bg-white/[0.04] backdrop-blur-md
              px-4 py-3 text-left
              transition-colors duration-200 hover:bg-white/[0.08]
            "
          >
            <FileText className="h-4 w-4 text-default-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground">Active intents</p>
              <p className="text-[11px] text-default-500">Open scheduled work</p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-default-400 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </>
  );
}
