import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  verifyPassword,
  createToken,
  sessionCookieName,
  sessionMaxAgeSeconds,
  adminConfigured,
  AppError,
} from "@/lib";
import { z } from "zod";

export const dynamic = "force-dynamic";

const loginSchema = z.object({ password: z.string().min(1) });

export const POST = withErrorHandling(async (req: Request) => {
  if (!adminConfigured()) {
    throw AppError.config(
      "Admin login disabled: set MODELHUB_ADMIN_PASSWORD to enable the console"
    );
  }
  const { password } = await parseJson(req, loginSchema);
  if (!verifyPassword(password)) {
    throw AppError.unauthorized("Incorrect password");
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName, createToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  });
  return res;
});
