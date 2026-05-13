import { NextResponse } from "next/server";

// Deprecated: login now goes through /api/pod/kratos-auth which issues
// both ory_kratos_session and eve-session in one shot.
export async function POST() {
  return NextResponse.json(
    { error: "gone", message: "Use POST /api/pod/kratos-auth instead." },
    { status: 410 },
  );
}
