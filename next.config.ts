import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a standalone server bundle for the Docker runtime stage.
  output: "standalone",
  // Private local tool; bind to localhost via `next start -H 127.0.0.1` if desired.
  // pino/pino-pretty spawn a worker thread via thread-stream that Next's bundler
  // cannot emit correctly (results in MODULE_NOT_FOUND for vendor-chunks/lib/worker.js).
  // Keep these external so they load from node_modules at runtime.
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream"],
};

export default nextConfig;
