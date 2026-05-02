/**
 * RSSHub feed persistence.
 *
 * The CLI's `RSSHubService` keeps feeds in memory — they don't survive a
 * process restart. The dashboard needs them durable, so we own the storage:
 * `${EVE_HOME}/.eve/feeds.json`.
 *
 * The RSSHub container doesn't need this file; it serves whatever URL we
 * point at it. This is the *user's* curated set of feeds Synap should
 * subscribe to.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Feed {
  name: string;
  url: string;
  status: "active" | "paused" | "error";
  addedAt?: string;
  lastFetch?: string;
}

interface FeedsFile {
  version: 1;
  feeds: Feed[];
}

function feedsPath(): string {
  // Fall back to homedir() (matches @eve/lifecycle convention) instead of
  // process.cwd() — in a Next.js server, cwd() is the project root, not the
  // user's eve workspace, which would silently scatter feeds.json into the
  // wrong place.
  const home = process.env.EVE_HOME || homedir();
  return join(home, ".eve", "feeds.json");
}

function isFeed(x: unknown): x is Feed {
  if (typeof x !== "object" || x === null) return false;
  const f = x as Record<string, unknown>;
  return typeof f.name === "string" && typeof f.url === "string"
    && (f.status === "active" || f.status === "paused" || f.status === "error");
}

export async function readFeeds(): Promise<Feed[]> {
  const path = feedsPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as unknown;
    if (typeof raw !== "object" || raw === null) return [];
    const file = raw as Partial<FeedsFile>;
    return Array.isArray(file.feeds) ? file.feeds.filter(isFeed) : [];
  } catch {
    return [];
  }
}

async function writeFeeds(feeds: Feed[]): Promise<void> {
  const path = feedsPath();
  await mkdir(dirname(path), { recursive: true });
  const body: FeedsFile = { version: 1, feeds };
  await writeFile(path, JSON.stringify(body, null, 2), { mode: 0o600 });
}

function isValidUrl(url: string): boolean {
  try { new URL(url); return true; } catch { return false; }
}

export async function addFeed(input: { name: string; url: string }): Promise<Feed> {
  const name = input.name.trim();
  const url = input.url.trim();
  if (name.length === 0) throw new Error("Feed name is required.");
  if (!isValidUrl(url)) throw new Error("Feed URL must be a valid URL.");

  const feeds = await readFeeds();
  if (feeds.some(f => f.name === name)) {
    throw new Error(`A feed named "${name}" already exists.`);
  }

  const feed: Feed = {
    name,
    url,
    status: "active",
    addedAt: new Date().toISOString(),
  };
  feeds.push(feed);
  await writeFeeds(feeds);
  return feed;
}

export async function removeFeed(name: string): Promise<boolean> {
  const feeds = await readFeeds();
  const next = feeds.filter(f => f.name !== name);
  if (next.length === feeds.length) return false;
  await writeFeeds(next);
  return true;
}
