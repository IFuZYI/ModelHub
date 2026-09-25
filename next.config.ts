import type { NextConfig } from "next";

// Optional custom admin path (obscures the default /admin). Set
// MODELHUB_ADMIN_PATH=/my-secret-console to serve the admin console there.
// Auth (MODELHUB_ADMIN_PASSWORD) is the real gate — this is only obscurity.
function adminRewrites() {
  const raw = process.env.MODELHUB_ADMIN_PATH?.trim();
  if (!raw || raw === "/admin") return [];
  const source = raw.startsWith("/") ? raw : `/${raw}`;
  // Alias the custom path onto the real /admin page.
  return [{ source, destination: "/admin" }];
}

const nextConfig: NextConfig = {
  // Emit a standalone server bundle for the Docker runtime stage.
  output: "standalone",
  // Permit the desktop preview to load dev fonts and client resources.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Hide the Next.js dev-tools floating indicator (bottom-corner "N" button).
  devIndicators: false,
  // Private local tool; bind to localhost via `next start -H 127.0.0.1` if desired.
  // pino/pino-pretty spawn a worker thread via thread-stream that Next's bundler
  // cannot emit correctly (results in MODULE_NOT_FOUND for vendor-chunks/lib/worker.js).
  // Keep these external so they load from node_modules at runtime.
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],
  async rewrites() {
    return adminRewrites();
  },
};

export default nextConfig;
