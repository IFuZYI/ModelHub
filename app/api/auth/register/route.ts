import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  registerSchema,
  authService,
  sessionCookieName,
  sessionMaxAgeSeconds,
} from "@/lib";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req: Request) => {
  const input = await parseJson(req, registerSchema);
  const { token, user } = await authService.register(input);
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
