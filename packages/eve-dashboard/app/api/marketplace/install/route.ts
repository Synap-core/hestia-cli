/**
 * `POST /api/marketplace/install` — server-side proxy for marketplace
 * installs. Mirrors the pattern of /api/marketplace/apps: forward
 * to the CP with the on-disk bearer attached. Authenticated calls
 * only — install is never anonymous.
 */

import { NextResponse } from "next/server";
import { readEveSecrets } from "@eve/dna";
import { requireAuth } from "@/lib/auth-server";
import { CP_BASE_URL } from "@/lib/cp-base-url";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const secrets = await readEveSecrets().catch(() => null);
  const token = secrets?.cp?.userToken?.trim();

  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in to install marketplace apps." },
      { status: 401 },
    );
  }

  // Pass through the request body verbatim — server-side validation lives
  // on the CP. The Zod schema on the upstream route is the source of truth.
  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${CP_BASE_URL}/api/marketplace/install`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "marketplace_unreachable",
        message: e instanceof Error ? e.message : "Network error",
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}
