/**
 * Hermes runtime status — polls the Hermes gateway at
 * `http://eve-builder-hermes:9119/api/status` with a 3 s timeout.
 *
 * Returns `{ running: false }` on any failure so the dashboard can
 * render a clean "not running" state instead of a generic error.
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";

export interface HermesStatus {
  running: boolean;
  model?: string;
  memoryProvider?: string;
  activeSessions?: number;
  mcpEnabled?: boolean;
}

export async function GET() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);

  try {
    const res = await fetch("http://eve-builder-hermes:9119/api/status", {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ running: false } satisfies HermesStatus);
    }

    const raw = (await res.json()) as Record<string, unknown>;

    return NextResponse.json({
      running: true,
      model: typeof raw.model === "string" ? raw.model : undefined,
      memoryProvider:
        typeof raw.memoryProvider === "string" ? raw.memoryProvider : undefined,
      activeSessions:
        typeof raw.activeSessions === "number" ? raw.activeSessions : 0,
      mcpEnabled: Boolean(raw.mcpEnabled),
    } satisfies HermesStatus);
  } catch {
    return NextResponse.json({ running: false } satisfies HermesStatus);
  } finally {
    clearTimeout(timeout);
  }
}
