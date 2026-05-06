"use client";

/**
 * Intelligence settings — Memory, Skills, System Skills.
 *
 * Three-tab view surfacing the pod's AI memory store, user-created
 * agent skills, and the built-in system skill packages.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Tabs, Tab, Chip, Button, Spinner, addToast,
} from "@heroui/react";
import {
  Brain, Zap, Package, Trash2, Play, ChevronDown, ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryFact {
  id: string;
  fact: string;
  confidence?: number;
  createdAt?: string;
}

interface Skill {
  id: string;
  name: string;
  description?: string;
  category?: string;
  status?: "active" | "inactive";
}

interface SystemSkillFile {
  path: string;
  content: string;
}

interface SystemSkillPackage {
  name: string;
  files: SystemSkillFile[];
}

// ---------------------------------------------------------------------------
// Memory tab
// ---------------------------------------------------------------------------

function MemoryTab() {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/intelligence/memory?limit=50", {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as unknown;
        setFacts(Array.isArray(data) ? (data as MemoryFact[]) : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const deleteFact = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/intelligence/memory/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setFacts((prev) => prev.filter((f) => f.id !== id));
        addToast({ title: "Memory fact deleted", color: "success" });
      } else {
        addToast({ title: "Failed to delete fact", color: "danger" });
      }
    } finally {
      setDeletingId(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="sm" />
      </div>
    );
  }

  if (facts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
        <Brain className="h-8 w-8 text-foreground/20" />
        <p className="text-sm text-foreground/40">No memory facts yet</p>
        <p className="text-xs text-foreground/30">
          The AI will store facts here as it learns about you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {facts.map((fact) => (
        <div
          key={fact.id}
          className="flex items-start gap-3 rounded-xl border border-divider bg-content2/40 px-4 py-3"
        >
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm text-foreground leading-relaxed">{fact.fact}</p>
            <div className="flex items-center gap-2">
              {fact.confidence != null && (
                <Chip size="sm" color="default" variant="flat">
                  {Math.round(fact.confidence * 100)}% confidence
                </Chip>
              )}
              {fact.createdAt && (
                <span className="text-[11px] text-foreground/40">
                  {new Date(fact.createdAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="light"
            color="danger"
            isIconOnly
            radius="md"
            isLoading={deletingId === fact.id}
            onPress={() => void deleteFact(fact.id)}
            aria-label="Delete memory fact"
          >
            {deletingId !== fact.id && <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills tab
// ---------------------------------------------------------------------------

function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [executingId, setExecutingId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/intelligence/skills", {
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as unknown;
          setSkills(Array.isArray(data) ? (data as Skill[]) : []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const execute = useCallback(async (id: string) => {
    setExecutingId(id);
    try {
      const res = await fetch(`/api/intelligence/skills/${id}/execute`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        addToast({ title: "Skill executed", color: "success" });
      } else {
        addToast({ title: "Execution failed", color: "danger" });
      }
    } finally {
      setExecutingId(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="sm" />
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
        <Zap className="h-8 w-8 text-foreground/20" />
        <p className="text-sm text-foreground/40">No custom skills yet</p>
        <p className="text-xs text-foreground/30">
          Create skills to extend what the AI can do.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className="flex items-center gap-3 rounded-xl border border-divider bg-content2/40 px-4 py-3"
        >
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">{skill.name}</p>
            {skill.description && (
              <p className="text-xs text-foreground/60 truncate">{skill.description}</p>
            )}
            <div className="flex items-center gap-2">
              {skill.category && (
                <Chip size="sm" color="default" variant="flat">
                  {skill.category}
                </Chip>
              )}
              <Chip
                size="sm"
                color={skill.status === "active" ? "success" : "warning"}
                variant="flat"
              >
                {skill.status ?? "unknown"}
              </Chip>
            </div>
          </div>
          <Button
            size="sm"
            variant="flat"
            color="primary"
            radius="md"
            isLoading={executingId === skill.id}
            onPress={() => void execute(skill.id)}
          >
            {executingId !== skill.id && <Play className="h-3 w-3 mr-1" />}
            Execute
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Skills tab
// ---------------------------------------------------------------------------

function SystemSkillsTab() {
  const [packages, setPackages] = useState<SystemSkillPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/intelligence/system-skills", {
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as unknown;
          setPackages(Array.isArray(data) ? (data as SystemSkillPackage[]) : []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="sm" />
      </div>
    );
  }

  if (packages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
        <Package className="h-8 w-8 text-foreground/20" />
        <p className="text-sm text-foreground/40">No system skills found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {packages.map((pkg) => {
        const open = expanded.has(pkg.name);
        return (
          <div
            key={pkg.name}
            className="rounded-xl border border-divider overflow-hidden"
          >
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 bg-content2/40 hover:bg-content2/70 transition-colors text-left"
              onClick={() => toggle(pkg.name)}
            >
              <Package className="h-4 w-4 text-foreground/40 shrink-0" />
              <span className="flex-1 text-sm font-medium text-foreground">
                {pkg.name}
              </span>
              <Chip size="sm" color="default" variant="flat">
                {pkg.files.length} {pkg.files.length === 1 ? "file" : "files"}
              </Chip>
              {open ? (
                <ChevronDown className="h-4 w-4 text-foreground/40 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-foreground/40 shrink-0" />
              )}
            </button>
            {open && (
              <div className="divide-y divide-divider">
                {pkg.files.map((file) => (
                  <div key={file.path} className="p-4 space-y-2">
                    <p className="text-[11px] font-mono text-foreground/40">{file.path}</p>
                    <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap break-words overflow-x-auto bg-content1 rounded-lg p-3 border border-divider">
                      {file.content}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IntelligencePage() {
  return (
    <div className="space-y-4">
      <Tabs
        aria-label="Intelligence sections"
        variant="underlined"
        color="primary"
        classNames={{
          base: "w-full",
          tabList:
            "gap-1 w-full p-0 border-b border-foreground/[0.06]",
          cursor: "w-full bg-primary",
          tab: "max-w-fit px-3 h-10",
          tabContent:
            "text-foreground/55 group-data-[selected=true]:text-foreground",
          panel: "pt-4 px-0",
        }}
      >
        <Tab
          key="memory"
          title={
            <span className="inline-flex items-center gap-1.5 text-[12.5px]">
              <Brain className="h-3.5 w-3.5" strokeWidth={2} />
              Memory
            </span>
          }
        >
          <MemoryTab />
        </Tab>
        <Tab
          key="skills"
          title={
            <span className="inline-flex items-center gap-1.5 text-[12.5px]">
              <Zap className="h-3.5 w-3.5" strokeWidth={2} />
              Skills
            </span>
          }
        >
          <SkillsTab />
        </Tab>
        <Tab
          key="system-skills"
          title={
            <span className="inline-flex items-center gap-1.5 text-[12.5px]">
              <Package className="h-3.5 w-3.5" strokeWidth={2} />
              System Skills
            </span>
          }
        >
          <SystemSkillsTab />
        </Tab>
      </Tabs>
    </div>
  );
}
