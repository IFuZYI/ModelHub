import { NextResponse } from "next/server";
import { withErrorHandling, sessionCookieName } from "@/lib";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
});
