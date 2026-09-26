import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";
import path from "path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: { "@": rootDir },
  },
});
