import { redirect } from "next/navigation";

/**
 * Legacy admin path. Provider management now lives in the unified console at
 * /console/providers; this forwards old bookmarks and the MODELHUB_ADMIN_PATH
 * rewrite target there.
 */
export default function AdminRedirect() {
  redirect("/console/providers");
}
