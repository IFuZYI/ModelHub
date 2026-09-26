import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  verifyEmailSchema,
  authService,
  sessionCookieName,
  sessionMaxAgeSeconds,
} from "@/lib";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: Request) => {
  const { email, code } = await parseJson(req, verifyEmailSchema);
  const { user, token } = await authService.verifyEmail(email, code);
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  });
  return res;
});
