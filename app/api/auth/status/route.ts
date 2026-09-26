import { NextResponse } from "next/server";
import {
  withErrorHandling,
  currentUser,
  adminConfigured,
  settingsService,
} from "@/lib";
import { userService } from "@/lib";

export const dynamic = "force-dynamic";

// Session + install/registration status for the client shell.
export const GET = withErrorHandling(async () => {
  const session = await currentUser();
  const settings = await settingsService.getPublic();
  let user = null;
  if (session) {
    user = await userService.getView(session.userId).catch(() => null);
  }
  return NextResponse.json({
    authenticated: session !== null,
    role: session?.role ?? "guest",
    user,
    adminConfigured: await adminConfigured(),
    registration_enabled: settings.registration_enabled,
    personal_pages_enabled: settings.personal_pages_enabled,
  });
});
