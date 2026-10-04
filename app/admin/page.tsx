import { redirect } from "next/navigation";

/**
 * Legacy admin path. Provider management now lives in the unified console at
 * /console/providers; this forwards old bookmarks there.
 *
 * It is also the rewrite target for MODELHUB_ADMIN_PATH (a build-time variable
 * handled in next.config.ts), so keep this route in place.
 */
export default function AdminRedirect() {
  redirect("/console/providers");
}
