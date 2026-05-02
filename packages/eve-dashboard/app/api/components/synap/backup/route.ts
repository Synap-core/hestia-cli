/**
 * One-click volume backup.
 *
 * POST { volume, dest? } → runs `docker run --rm -v <volume>:/data alpine
 * tar czf /backup/<name>.tar.gz` against a host-mounted backup directory.
 * Default dest is `${EVE_HOME}/backups`.
 *
 * Streams progress over SSE so the UI can show the user it's running. The
 * response ends with a `done` event carrying the backup path + size.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-server";

interface BackupBody {
  volume?: string;
  /** Destination dir on the host. Default: ${EVE_HOME}/backups */
  dest?: string;
}

/**
 * Volume name validator.
 *
 * Docker volume names match `[a-zA-Z0-9][a-zA-Z0-9_.-]*` per the engine
 * docs. We're stricter: no leading dot, no `..`. The dot has to be allowed
 * since real volume names contain `.` (e.g. `my-app_data.v2`), but `..`
 * would let `path.join(dest, filename)` escape `dest`.
 */
function safeName(s: string): boolean {
  if (s.length === 0 || s.length > 128) return false;
  if (s.includes("..")) return false;
  if (s.startsWith(".")) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(s);
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as BackupBody;
  const volume = body.volume?.trim();

  if (!volume || !safeName(volume)) {
    return NextResponse.json(
      { error: "`volume` is required and must match [a-zA-Z0-9_.-]+" },
      { status: 400 },
    );
  }

  // Resolve EVE_HOME and dest to absolute paths so we can safely test
  // containment with `startsWith(eveHome + sep)` (without `sep`,
  // `/home/alice` would match `/home/alice-evil`).
  const eveHome = resolve(process.env.EVE_HOME || homedir());
  const destResolved = body.dest?.trim()
    ? resolve(body.dest.trim())
    : join(eveHome, "backups");

  if (destResolved !== eveHome && !destResolved.startsWith(eveHome + sep)) {
    return NextResponse.json(
      { error: `dest must be inside EVE_HOME (${eveHome})` },
      { status: 400 },
    );
  }

  mkdirSync(destResolved, { recursive: true });

  // Filename includes a timestamp so re-running doesn't overwrite.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${volume}-${stamp}.tar.gz`;
  const fullPath = resolve(destResolved, filename);

  // Belt + braces: even with a validated `volume` the resolved fullPath must
  // stay inside destResolved. If it doesn't, abort.
  if (!fullPath.startsWith(destResolved + sep)) {
    return NextResponse.json(
      { error: "Refusing to write outside the backup directory" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  let child: ReturnType<typeof spawn> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (ev: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`)); }
        catch { /* controller already closed */ }
      };

      send({ type: "step", label: `Backing up ${volume}…` });

      // Mount the backup dir into a fresh alpine container, tar the volume.
      // We use a generic alpine because it's tiny + ubiquitous; tar is built
      // into it.
      child = spawn("docker", [
        "run", "--rm",
        "-v", `${volume}:/data:ro`,
        "-v", `${destResolved}:/backup`,
        "alpine",
        "tar", "czf", `/backup/${filename}`, "-C", "/data", ".",
      ], { stdio: ["ignore", "pipe", "pipe"] });

      // Long backups can run for many minutes — keepalive every 25s so
      // intermediate proxies (Traefik / Cloudflare) don't drop the SSE.
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); }
        catch { if (heartbeat) clearInterval(heartbeat); }
      }, 25_000);

      const onChunk = (buf: Buffer) => {
        const text = buf.toString("utf-8");
        for (const line of text.split(/\r?\n/)) {
          if (line.length > 0) send({ type: "log", line });
        }
      };
      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", onChunk);

      child.on("close", (code) => {
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        if (code === 0 && existsSync(fullPath)) {
          const size = statSync(fullPath).size;
          send({
            type: "done",
            summary: `Backup written to ${fullPath} (${formatBytes(size)})`,
            path: fullPath,
            size,
          });
        } else {
          send({
            type: "error",
            message: `tar exited ${code}`,
          });
        }
        try { controller.enqueue(encoder.encode(`event: end\ndata: \n\n`)); }
        catch { /* already closed */ }
        try { controller.close(); } catch { /* already closed */ }
      });

      child.on("error", (err) => {
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
        send({ type: "error", message: err.message });
        try { controller.close(); } catch { /* already closed */ }
      });
    },

    /** Client disconnected mid-backup — kill the alpine container so it
     *  doesn't keep tar'ing into a destination nobody's listening for. */
    cancel() {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      if (child && !child.killed) child.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
