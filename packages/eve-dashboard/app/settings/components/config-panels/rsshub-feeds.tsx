"use client";

/**
 * RSSHub feeds panel — embedded as the Config tab in the component drawer
 * when the selected component is `rsshub`.
 *
 * Storage lives in `${EVE_HOME}/.eve/feeds.json` (see lib/feeds.ts).
 * Synap subscription wiring happens elsewhere — this UI just curates the
 * list. The "Open" button on the row jumps to `feeds.<domain>/<route>`
 * which is what RSSHub actually serves.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Input, Button, Spinner, Chip, addToast,
} from "@heroui/react";
import { Plus, Trash2, ExternalLink, Rss } from "lucide-react";

interface Feed {
  name: string;
  url: string;
  status: "active" | "paused" | "error";
  addedAt?: string;
}

export function RsshubFeedsPanel() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const fetchFeeds = useCallback(async () => {
    const res = await fetch("/api/components/rsshub/feeds", { credentials: "include" });
    if (res.ok) {
      const data = await res.json() as { feeds: Feed[] };
      setFeeds(data.feeds);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchFeeds(); }, [fetchFeeds]);

  const onAdd = useCallback(async () => {
    if (!name.trim() || !url.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/components/rsshub/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), url: url.trim() }),
      });
      if (res.ok) {
        addToast({ title: `Feed "${name.trim()}" added`, color: "success" });
        setName("");
        setUrl("");
        void fetchFeeds();
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        addToast({ title: err.error ?? "Couldn't add feed", color: "danger" });
      }
    } catch {
      addToast({ title: "Couldn't add feed", color: "danger" });
    } finally { setAdding(false); }
  }, [name, url, fetchFeeds]);

  const onRemove = useCallback(async (n: string) => {
    setRemoving(n);
    try {
      const res = await fetch(`/api/components/rsshub/feeds/${encodeURIComponent(n)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        addToast({ title: `Feed "${n}" removed`, color: "success" });
        void fetchFeeds();
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        addToast({ title: err.error ?? "Couldn't remove feed", color: "danger" });
      }
    } catch {
      addToast({ title: "Couldn't remove feed", color: "danger" });
    } finally { setRemoving(null); }
  }, [fetchFeeds]);

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <Plus className="h-3.5 w-3.5" />
          <span>Add feed</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            size="sm"
            variant="bordered"
            label="Name"
            labelPlacement="outside"
            placeholder="hacker-news"
            value={name}
            onValueChange={setName}
            isDisabled={adding}
          />
          <div className="sm:col-span-2">
            <Input
              size="sm"
              variant="bordered"
              label="URL"
              labelPlacement="outside"
              placeholder="https://news.ycombinator.com/rss"
              value={url}
              onValueChange={setUrl}
              isDisabled={adding}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            color="primary"
            radius="md"
            startContent={<Plus className="h-3.5 w-3.5" />}
            isLoading={adding}
            isDisabled={!name.trim() || !url.trim()}
            onPress={() => void onAdd()}
          >
            Add feed
          </Button>
        </div>
      </div>

      {/* List */}
      {loading || !feeds ? (
        <div className="flex items-center justify-center py-6">
          <Spinner size="sm" color="primary" />
        </div>
      ) : feeds.length === 0 ? (
        <div className="rounded-lg border border-divider bg-content2/40 px-4 py-6 text-center text-sm text-default-500">
          <Rss className="h-5 w-5 mx-auto mb-2 text-default-400" />
          <p>No feeds yet — add one above.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-divider">
          {feeds.map((f, i) => (
            <div
              key={f.name}
              className={
                "flex items-center gap-3 px-4 py-3 " +
                (i === 0 ? "" : "border-t border-divider")
              }
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-foreground truncate">{f.name}</span>
                  <Chip
                    size="sm"
                    variant="flat"
                    radius="sm"
                    color={f.status === "active" ? "success" : f.status === "error" ? "danger" : "warning"}
                  >
                    {f.status}
                  </Chip>
                </div>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-mono text-default-500 hover:text-primary truncate"
                  title={f.url}
                >
                  {f.url}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
              <Button
                size="sm"
                variant="light"
                radius="md"
                color="danger"
                startContent={<Trash2 className="h-3.5 w-3.5" />}
                isLoading={removing === f.name}
                isDisabled={removing !== null}
                onPress={() => void onRemove(f.name)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
