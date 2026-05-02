/**
 * Streaming log feed for one component.
 *
 * GET  /api/components/[id]/logs           → static tail-N (default 200)
 * GET  /api/components/[id]/logs?stream=1  → SSE follow stream of `docker logs -f`
 *
 * The streaming variant is the live counterpart of the static `logs` field
 * baked into the GET /api/components/[id] response.
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { resolveComponent } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";

const execFileAsync = promisify(execFile);

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;

  let containerName: string | null = null;
  try {
    const comp = resolveComponent(id);
    containerName = comp.service?.containerName ?? null;
  } catch {
    return NextResponse.json({ error: `Unknown component: ${id}` }, { status: 404 });
  }

  if (!containerName) {
    return NextResponse.json(
      { error: "This component has no container — nothing to stream." },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const wantsStream = url.searchParams.get("stream") === "1";
  const tail = clampInt(url.searchParams.get("tail"), 50, 1, 5000);

  if (wantsStream) {
    return streamLogs(containerName, tail);
  }

  // Static tail — same as GET /api/components/[id].logs but on demand and
  // with configurable tail size.
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["logs", "--tail", String(tail), containerName],
      { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
    );
    return new NextResponse(stdout, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "docker logs failed" },
      { status: 500 },
    );
  }
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (raw === null) return def;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

/**
 * SSE follow stream. Each line of `docker logs -f` becomes one SSE event.
 *
 * The client is responsible for closing the connection (cancels via
 * AbortController). When the response body is cancelled we receive `cancel`
 * on the controller and SIGTERM the docker child so the daemon stops
 * pumping bytes our way.
 */
function streamLogs(containerName: string, tail: number): Response {
  const encoder = new TextEncoder();

  let child: ReturnType<typeof spawn> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      child = spawn("docker", ["logs", "-f", "--tail", String(tail), containerName], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const onData = (buf: Buffer) => {
        const text = buf.toString("utf-8");
        for (const line of text.split(/\r?\n/)) {
          if (line.length === 0) continue;
          // Wrap each line as a single SSE message. JSON-encoding keeps
          // newlines + control chars safe for the EventSource framing.
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
        }
      };

      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);

      child.on("close", (code) => {
        controller.enqueue(
          encoder.encode(`event: end\ndata: ${JSON.stringify({ code })}\n\n`),
        );
        try { controller.close(); } catch { /* already closed */ }
      });

      child.on("error", (err) => {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`),
        );
        try { controller.close(); } catch { /* already closed */ }
      });

      // Keepalive — Traefik / Cloudflare drop idle SSE connections after
      // ~60s. A heartbeat every 25s keeps the pipe warm without polluting
      // the visible log feed.
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); }
        catch { clearInterval(heartbeat); }
      }, 25_000);

      child.on("close", () => clearInterval(heartbeat));
    },

    cancel() {
      if (child && !child.killed) {
        child.kill("SIGTERM");
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
