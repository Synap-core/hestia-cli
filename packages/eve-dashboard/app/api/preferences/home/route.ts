import { NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { requireAuth } from "@/lib/auth-server";

const PREFS_DIR = join(homedir(), ".eve");
const PREFS_PATH = join(PREFS_DIR, "preferences.json");

interface PinnedApp {
  id: string;
  name: string;
  slug: string;
  url: string;
  iconUrl?: string | null;
}

interface EvePreferences {
  home?: {
    pinnedApps?: PinnedApp[];
  };
}

async function readPreferences(): Promise<EvePreferences> {
  try {
    return JSON.parse(await readFile(PREFS_PATH, "utf-8")) as EvePreferences;
  } catch {
    return {};
  }
}

async function writePreferences(prefs: EvePreferences): Promise<void> {
  await mkdir(PREFS_DIR, { recursive: true });
  await writeFile(PREFS_PATH, JSON.stringify(prefs, null, 2), { mode: 0o644 });
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const prefs = await readPreferences();
  const pinnedApps = prefs.home?.pinnedApps ?? [];

  return NextResponse.json({
    pinnedAppIds: pinnedApps.map((a) => a.id),
    pinnedApps,
  });
}

export async function PUT(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => null)) as { pinnedApps?: unknown } | null;
  if (!body || !Array.isArray(body.pinnedApps)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Sanitize each entry — only allow the fields we know about.
  const pinnedApps: PinnedApp[] = (body.pinnedApps as PinnedApp[]).map((a) => ({
    id: String(a.id),
    name: String(a.name),
    slug: String(a.slug),
    url: String(a.url),
    iconUrl: a.iconUrl ? String(a.iconUrl) : null,
  }));

  const prefs = await readPreferences();
  prefs.home = { ...prefs.home, pinnedApps };
  await writePreferences(prefs);

  return NextResponse.json({ ok: true, pinnedAppIds: pinnedApps.map((a) => a.id) });
}
