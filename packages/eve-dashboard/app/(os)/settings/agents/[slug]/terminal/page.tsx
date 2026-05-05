"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Terminal as TermIcon, FileText, Workflow } from "lucide-react";
import { agentDisplay, agentTerminalKinds, type TerminalKind } from "../../lib/agent-terminal-map";
import { ReplPanel } from "../../components/repl-panel";
import { LogTailPanel } from "../../components/log-tail-panel";
import { RecipeRunnerPanel } from "../../components/recipe-runner-panel";

interface PageParams {
  slug: string;
}

const KIND_META: Record<TerminalKind, { label: string; icon: typeof TermIcon; description: string }> = {
  repl: {
    label: "REPL",
    icon: TermIcon,
    description: "Interactive subprocess. Bidirectional stdin/stdout over a pty.",
  },
  logs: {
    label: "Logs",
    icon: FileText,
    description: "Read-only stream of `docker logs -f`. Last 200 lines as context.",
  },
  recipe: {
    label: "Recipe",
    icon: Workflow,
    description: "Sequential command runner. Each step's output streams in turn.",
  },
};

export default function AgentTerminalPage(props: { params: Promise<PageParams> }) {
  const { slug } = use(props.params);
  const agent = agentDisplay(slug);
  const kinds = agentTerminalKinds(slug);
  const [activeKind, setActiveKind] = useState<TerminalKind | null>(kinds[0] ?? null);

  if (!agent || kinds.length === 0) {
    return (
      <div className="space-y-6">
        <Link
          href="/settings/agents"
          className="inline-flex items-center gap-1.5 text-sm text-default-500 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Agents
        </Link>
        <div className="rounded-xl border border-divider bg-content1 p-6">
          <p className="font-medium text-foreground">Unknown agent</p>
          <p className="mt-1 text-sm text-default-500">
            No agent registered with slug <span className="font-mono">{slug}</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/settings/agents"
          className="inline-flex items-center gap-1.5 text-sm text-default-500 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Agents
        </Link>
        <div>
          <p className="text-sm font-medium text-default-500">Terminal</p>
          <h1 className="mt-0.5 font-heading text-3xl font-medium tracking-tightest text-foreground">
            {agent.label}
          </h1>
          <p className="mt-1 text-sm text-default-500">{agent.description}</p>
        </div>
      </header>

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 border-b border-divider">
        {kinds.map((kind) => {
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          const active = kind === activeKind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => setActiveKind(kind)}
              className={
                "inline-flex items-center gap-1.5 px-3 py-2 text-sm transition-colors -mb-px border-b-2 " +
                (active
                  ? "border-primary text-foreground"
                  : "border-transparent text-default-500 hover:text-foreground")
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
            </button>
          );
        })}
      </div>

      {activeKind && (
        <p className="text-xs text-default-400">{KIND_META[activeKind].description}</p>
      )}

      <div className="rounded-xl border border-divider bg-content1 overflow-hidden">
        {activeKind === "repl" && <ReplPanel slug={slug} />}
        {activeKind === "logs" && <LogTailPanel slug={slug} />}
        {activeKind === "recipe" && <RecipeRunnerPanel slug={slug} />}
      </div>
    </div>
  );
}
